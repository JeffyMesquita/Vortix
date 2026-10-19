using Microsoft.Data.Sqlite;
using Microsoft.AspNetCore.DataProtection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;

internal sealed class LocalDataStore
{
    private static readonly HashSet<string> AllowedStores = new(StringComparer.Ordinal)
    {
        "history", "collections", "environments", "settings"
    };

    private const string ProtectedPrefix = "APISTUDIO:DATA-PROTECTION:v1:";
    private const string LegacyProtectedPrefix = "APISTUDIO:DPAPI:v1:";
    private const string WorkspaceBackupFormat = "api-studio-workspace";
    private const string WorkspaceBackupTimestampForSize = "2000-01-01T00:00:00.000Z";
    private const int WorkspaceRecordLimit = 1000;
    private const int HostedCookieJarSessionLimitBytes = 256 * 1024;
    private const int HostedCookieJarStoreLimitBytes = 4 * 1024 * 1024;
    /// <summary>Gets the maximum number of environments accepted in a hosted cookie-jar restore.</summary>
    internal const int MaxHostedCookieJarEnvironmentCount = WorkspaceRecordLimit;
    /// <summary>Gets the maximum number of cookies allowed in one environment jar.</summary>
    internal const int MaxHostedCookieJarCookieCount = 300;
    private static readonly JsonSerializerOptions WorkspaceBackupSizeJsonOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };
    private readonly string _connectionString;
    private readonly IDataProtector _protector;
    private readonly long? _maxWorkspaceBackupBytes;
    private int _tokenCredentialModeRecoveryWarning;

    public LocalDataStore(string databasePath, IDataProtector protector, long? maxWorkspaceBackupBytes = null)
    {
        if (maxWorkspaceBackupBytes is <= 0) throw new ArgumentOutOfRangeException(nameof(maxWorkspaceBackupBytes));
        _protector = protector;
        _maxWorkspaceBackupBytes = maxWorkspaceBackupBytes;
        DatabasePath = Path.GetFullPath(databasePath);
        Directory.CreateDirectory(Path.GetDirectoryName(DatabasePath)!);
        _connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = DatabasePath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Shared
        }.ToString();
    }

    public string DatabasePath { get; }

    /// <summary>Consumes the warning raised when an unreadable token transport preference uses the safe default.</summary>
    /// <returns><see langword="true" /> if a read used the recovery default; otherwise, <see langword="false" />.</returns>
    public bool ConsumeTokenCredentialModeRecoveryWarning() => Interlocked.Exchange(ref _tokenCredentialModeRecoveryWarning, 0) != 0;
    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            CREATE TABLE IF NOT EXISTS api_studio_data (
                store TEXT NOT NULL,
                record_key TEXT NOT NULL,
                json TEXT NOT NULL,
                PRIMARY KEY (store, record_key)
            ) WITHOUT ROWID;
            """;
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<JsonElement>> ReadAllAsync(string store, CancellationToken cancellationToken = default)
    {
        ValidateStore(store);
        await using var connection = await OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT json FROM api_studio_data WHERE store = $store ORDER BY record_key";
        command.Parameters.AddWithValue("$store", store);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var values = new List<JsonElement>();
        while (await reader.ReadAsync(cancellationToken))
        {
            using var document = JsonDocument.Parse(reader.GetString(0));
            values.Add(UnprotectJson(document.RootElement));
        }
        return values;
    }

    public async Task<JsonElement?> ReadAsync(string store, string key, CancellationToken cancellationToken = default)
    {
        ValidateStore(store);
        await using var connection = await OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT json FROM api_studio_data WHERE store = $store AND record_key = $key";
        command.Parameters.AddWithValue("$store", store);
        command.Parameters.AddWithValue("$key", key);
        var value = await command.ExecuteScalarAsync(cancellationToken);
        if (value is not string json)
        {
            return null;
        }

        using var document = JsonDocument.Parse(json);
        return UnprotectJson(document.RootElement);
    }

    /// <summary>Reads cookie jars owned by one hosted browser session.</summary>
    /// <param name="sessionId">The anonymous browser session identifier.</param>
    /// <param name="cancellationToken">A token that cancels the operation.</param>
    /// <returns>The environment-scoped cookie jars for the session.</returns>
    /// <exception cref="ArgumentException">The session identifier is invalid.</exception>
    public async Task<IReadOnlyDictionary<string, JsonElement>> ReadHostedCookieJarsAsync(string sessionId, CancellationToken cancellationToken = default)
    {
        ValidateHostedCookieSession(sessionId);
        var prefix = "cookiejar:" + sessionId + ":";
        await using var connection = await OpenAsync(cancellationToken);
        await using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT record_key, json FROM api_studio_data WHERE store = 'settings' AND substr(record_key, 1, length($prefix)) = $prefix ORDER BY record_key";
        command.Parameters.AddWithValue("$prefix", prefix);
        var jars = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        var unreadableKeys = new List<string>();
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                var key = reader.GetString(0);
                if (!TryGetHostedCookieJarIdentity(key, out _, out var environmentId)) continue;
                try
                {
                    using var document = JsonDocument.Parse(reader.GetString(1));
                    var record = UnprotectJson(document.RootElement);
                    if (record.ValueKind == JsonValueKind.Object && record.TryGetProperty("value", out var value) && IsCookieJarValue(value))
                        jars[environmentId] = value.Clone();
                    else unreadableKeys.Add(key);
                }
                catch (CryptographicException) { unreadableKeys.Add(key); }
                catch (JsonException) { unreadableKeys.Add(key); }
            }
        }
        foreach (var key in unreadableKeys)
        {
            await using var delete = connection.CreateCommand();
            delete.Transaction = transaction;
            delete.CommandText = "DELETE FROM api_studio_data WHERE store = 'settings' AND record_key = $key";
            delete.Parameters.AddWithValue("$key", key);
            await delete.ExecuteNonQueryAsync(cancellationToken);
        }
        await transaction.CommitAsync(cancellationToken);
        return jars;
    }

    /// <summary>Writes one hosted cookie jar while enforcing session and shared-store quotas.</summary>
    /// <param name="sessionId">The anonymous browser session identifier.</param>
    /// <param name="environmentId">The environment that owns the cookie jar.</param>
    /// <param name="value">The validated cookie jar value.</param>
    /// <param name="cancellationToken">A token that cancels the operation.</param>
    /// <exception cref="ArgumentException">The session, environment, or cookie jar value is invalid.</exception>
    /// <exception cref="HostedCookieJarLimitExceededException">The session exceeds its cookie storage quota.</exception>
    public async Task WriteHostedCookieJarAsync(string sessionId, string environmentId, JsonElement value, CancellationToken cancellationToken = default)
    {
        ValidateHostedCookieSession(sessionId);
        ValidateHostedCookieEnvironment(environmentId);
        if (!IsCookieJarValue(value)) throw new ArgumentException("Cookie jar inválido.", nameof(value));
        if (value.GetProperty("cookies").GetArrayLength() == 0)
        {
            await DeleteAsync("settings", HostedCookieStorageKey(sessionId, environmentId), cancellationToken);
            return;
        }
        await WriteHostedCookieJarsCoreAsync(sessionId, new Dictionary<string, JsonElement>(StringComparer.Ordinal) { [environmentId] = value }, replaceSession: false, cancellationToken);
    }

    /// <summary>Replaces one hosted browser session's cookie jars in a single SQLite transaction.</summary>
    /// <param name="sessionId">The anonymous browser session identifier.</param>
    /// <param name="jars">The complete environment-to-cookie-jar map for the session.</param>
    /// <param name="cancellationToken">A token that cancels the operation.</param>
    /// <exception cref="ArgumentException">The session, environment, or cookie jar value is invalid.</exception>
    /// <exception cref="HostedCookieJarLimitExceededException">The session exceeds its cookie storage quota.</exception>
    public async Task ReplaceHostedCookieJarsAsync(string sessionId, IReadOnlyDictionary<string, JsonElement> jars, CancellationToken cancellationToken = default)
    {
        ValidateHostedCookieSession(sessionId);
        if (jars.Count > MaxHostedCookieJarEnvironmentCount) throw new ArgumentException("O backup contém ambientes demais.", nameof(jars));
        foreach (var (environmentId, value) in jars)
        {
            ValidateHostedCookieEnvironment(environmentId);
            if (!IsCookieJarValue(value)) throw new ArgumentException("Cookie jar inválido.", nameof(jars));
        }
        await WriteHostedCookieJarsCoreAsync(sessionId, jars, replaceSession: true, cancellationToken);
    }

    private async Task WriteHostedCookieJarsCoreAsync(string sessionId, IReadOnlyDictionary<string, JsonElement> jars, bool replaceSession, CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;
        var incoming = new Dictionary<string, (string Key, string Json, long Size)>(StringComparer.Ordinal);
        foreach (var (environmentId, value) in jars)
        {
            if (value.GetProperty("cookies").GetArrayLength() == 0) continue;
            var key = HostedCookieStorageKey(sessionId, environmentId);
            var record = JsonSerializer.SerializeToElement(new { key, updatedAt = now, value }, new JsonSerializerOptions(JsonSerializerDefaults.Web));
            var protectedJson = ProtectJson(record).GetRawText();
            incoming[environmentId] = (key, protectedJson, Encoding.UTF8.GetByteCount(key) + Encoding.UTF8.GetByteCount(protectedJson));
        }

        await using var connection = await OpenAsync(cancellationToken);
        await using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync(cancellationToken);
        var entries = await ReadHostedCookieJarEntriesAsync(connection, transaction, cancellationToken);
        var replacedEnvironments = replaceSession ? null : incoming.Keys.ToHashSet(StringComparer.Ordinal);
        var retained = entries.Where(entry => entry.SessionId != sessionId || (!replaceSession && !replacedEnvironments!.Contains(entry.EnvironmentId))).ToList();
        var sessionEntries = retained.Where(entry => entry.SessionId == sessionId).ToArray();
        var newSessionBytes = incoming.Values.Sum(entry => entry.Size);
        await using var settingsCountCommand = connection.CreateCommand();
        settingsCountCommand.Transaction = transaction;
        settingsCountCommand.CommandText = "SELECT COUNT(*) FROM api_studio_data WHERE store = 'settings'";
        var nonCookieSettingsCount = Convert.ToInt64(await settingsCountCommand.ExecuteScalarAsync(cancellationToken)) - entries.Count;
        if (sessionEntries.Length + incoming.Count > MaxHostedCookieJarEnvironmentCount ||
            sessionEntries.Sum(entry => entry.Size) + newSessionBytes > HostedCookieJarSessionLimitBytes)
            throw new HostedCookieJarLimitExceededException();

        var remainingBytes = retained.Sum(entry => entry.Size) + newSessionBytes;
        var remainingSettingsCount = nonCookieSettingsCount + retained.Count + incoming.Count;
        var evictedSessions = new HashSet<string>(StringComparer.Ordinal);
        if (remainingBytes > HostedCookieJarStoreLimitBytes || remainingSettingsCount > WorkspaceRecordLimit)
        {
            foreach (var inactiveSession in retained.Where(entry => entry.SessionId != sessionId)
                         .GroupBy(entry => entry.SessionId)
                         .Select(group => new { SessionId = group.Key, Size = group.Sum(entry => entry.Size), Count = group.Count(), LastWrite = group.Max(entry => entry.LastWriteUtc) })
                         .OrderBy(group => group.LastWrite))
            {
                evictedSessions.Add(inactiveSession.SessionId);
                remainingBytes -= inactiveSession.Size;
                remainingSettingsCount -= inactiveSession.Count;
                if (remainingBytes <= HostedCookieJarStoreLimitBytes && remainingSettingsCount <= WorkspaceRecordLimit) break;
            }
        }
        if (remainingBytes > HostedCookieJarStoreLimitBytes || remainingSettingsCount > WorkspaceRecordLimit) throw new HostedCookieJarLimitExceededException();

        await using (var delete = connection.CreateCommand())
        {
            delete.Transaction = transaction;
            delete.CommandText = replaceSession
                ? "DELETE FROM api_studio_data WHERE store = 'settings' AND substr(record_key, 1, length($prefix)) = $prefix"
                : "DELETE FROM api_studio_data WHERE store = 'settings' AND record_key = $key";
            if (replaceSession) delete.Parameters.AddWithValue("$prefix", "cookiejar:" + sessionId + ":");
            else
            {
                var keys = incoming.Values.Select(entry => entry.Key).ToArray();
                foreach (var key in keys)
                {
                    delete.Parameters.Clear();
                    delete.Parameters.AddWithValue("$key", key);
                    await delete.ExecuteNonQueryAsync(cancellationToken);
                }
            }
            if (replaceSession) await delete.ExecuteNonQueryAsync(cancellationToken);
        }
        foreach (var evictedSession in evictedSessions)
        {
            await using var delete = connection.CreateCommand();
            delete.Transaction = transaction;
            delete.CommandText = "DELETE FROM api_studio_data WHERE store = 'settings' AND substr(record_key, 1, length($prefix)) = $prefix";
            delete.Parameters.AddWithValue("$prefix", "cookiejar:" + evictedSession + ":");
            await delete.ExecuteNonQueryAsync(cancellationToken);
        }
        await using (var insert = connection.CreateCommand())
        {
            insert.Transaction = transaction;
            insert.CommandText = "INSERT INTO api_studio_data(store, record_key, json) VALUES ('settings', $key, $json)";
            var keyParameter = insert.Parameters.Add("$key", SqliteType.Text);
            var jsonParameter = insert.Parameters.Add("$json", SqliteType.Text);
            foreach (var entry in incoming.Values)
            {
                keyParameter.Value = entry.Key;
                jsonParameter.Value = entry.Json;
                await insert.ExecuteNonQueryAsync(cancellationToken);
            }
        }
        await EnsureWorkspaceBackupFitsAsync(connection, transaction, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    private static async Task<List<HostedCookieJarEntry>> ReadHostedCookieJarEntriesAsync(SqliteConnection connection, SqliteTransaction transaction, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT record_key, json FROM api_studio_data WHERE store = 'settings' AND substr(record_key, 1, 10) = 'cookiejar:'";
        var entries = new List<HostedCookieJarEntry>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var key = reader.GetString(0);
            var json = reader.GetString(1);
            if (!TryGetHostedCookieJarIdentity(key, out var sessionId, out var environmentId)) continue;
            var lastWrite = DateTimeOffset.MinValue;
            try
            {
                using var document = JsonDocument.Parse(json);
                if (document.RootElement.TryGetProperty("updatedAt", out var value) && value.ValueKind == JsonValueKind.String &&
                    DateTimeOffset.TryParse(value.GetString(), out var parsed)) lastWrite = parsed;
            }
            catch (JsonException) { }
            entries.Add(new HostedCookieJarEntry(key, sessionId, environmentId, Encoding.UTF8.GetByteCount(key) + Encoding.UTF8.GetByteCount(json), lastWrite));
        }
        return entries;
    }

    private static bool IsCookieJarValue(JsonElement value) => value.ValueKind == JsonValueKind.Object &&
        value.TryGetProperty("cookies", out var cookies) && cookies.ValueKind == JsonValueKind.Array && cookies.GetArrayLength() <= MaxHostedCookieJarCookieCount;

    private static bool TryGetHostedCookieJarIdentity(string key, out string sessionId, out string environmentId)
    {
        sessionId = string.Empty;
        environmentId = string.Empty;
        const string prefix = "cookiejar:";
        var separator = key.IndexOf(':', prefix.Length);
        if (!key.StartsWith(prefix, StringComparison.Ordinal) || separator - prefix.Length != 43 || separator == key.Length - 1) return false;
        sessionId = key[prefix.Length..separator];
        environmentId = key[(separator + 1)..];
        return sessionId.All(character => char.IsAsciiLetterOrDigit(character) || character is '-' or '_');
    }

    private static void ValidateHostedCookieSession(string sessionId)
    {
        if (sessionId.Length != 43 || sessionId.Any(character => !char.IsAsciiLetterOrDigit(character) && character is not ('-' or '_')))
            throw new ArgumentException("Sessão de cookie inválida.", nameof(sessionId));
    }

    private static void ValidateHostedCookieEnvironment(string environmentId)
    {
        if (string.IsNullOrWhiteSpace(environmentId) || environmentId.Length > 128 || environmentId.Contains('\r') || environmentId.Contains('\n'))
            throw new ArgumentException("Ambiente de cookie inválido.", nameof(environmentId));
    }

    private static string HostedCookieStorageKey(string sessionId, string environmentId) => "cookiejar:" + sessionId + ":" + environmentId;

    private sealed record HostedCookieJarEntry(string Key, string SessionId, string EnvironmentId, long Size, DateTimeOffset LastWriteUtc);

    public async Task WriteAsync(string store, JsonElement value, CancellationToken cancellationToken = default)
    {
        await WriteRecordAsync(store, value, null, cancellationToken);
    }

    public async Task<int> WriteHistoryAsync(JsonElement value, int retentionLimit, CancellationToken cancellationToken = default)
    {
        if (retentionLimit is < 1 or > 5000) throw new ArgumentOutOfRangeException(nameof(retentionLimit));
        return await WriteRecordAsync("history", value, retentionLimit, cancellationToken);
    }

    private async Task<int> WriteRecordAsync(string store, JsonElement value, int? historyRetentionLimit, CancellationToken cancellationToken)
    {
        ValidateStore(store);
        var key = GetRecordKey(store, value);
        await using var connection = await OpenAsync(cancellationToken);
        await using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO api_studio_data(store, record_key, json) VALUES ($store, $key, $json)
            ON CONFLICT(store, record_key) DO UPDATE SET json = excluded.json
            """;
        command.Parameters.AddWithValue("$store", store);
        command.Parameters.AddWithValue("$key", key);
        command.Parameters.AddWithValue("$json", ProtectJson(value).GetRawText());
        await command.ExecuteNonQueryAsync(cancellationToken);
        var removed = historyRetentionLimit.HasValue
            ? await RetainHistoryAsync(connection, transaction, historyRetentionLimit.Value, cancellationToken)
            : 0;
        await EnsureWorkspaceBackupFitsAsync(connection, transaction, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return removed;
    }

    public async Task<int> ImportLegacyBatchAsync(string store, JsonElement values, CancellationToken cancellationToken = default)
    {
        ValidateStore(store);
        if (values.ValueKind != JsonValueKind.Array || values.GetArrayLength() > 100)
        {
            throw new ArgumentException("A migração aceita lotes de até 100 registros.", nameof(values));
        }

        await using var connection = await OpenAsync(cancellationToken);
        await using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "INSERT OR IGNORE INTO api_studio_data(store, record_key, json) VALUES ($store, $key, $json)";
        var storeParameter = command.Parameters.Add("$store", SqliteType.Text);
        var keyParameter = command.Parameters.Add("$key", SqliteType.Text);
        var jsonParameter = command.Parameters.Add("$json", SqliteType.Text);
        storeParameter.Value = store;

        var inserted = 0;
        foreach (var item in values.EnumerateArray())
        {
            keyParameter.Value = GetRecordKey(store, item);
            jsonParameter.Value = ProtectJson(item).GetRawText();
            inserted += await command.ExecuteNonQueryAsync(cancellationToken);
        }

        await EnsureWorkspaceBackupFitsAsync(connection, transaction, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return inserted;
    }

    public async Task<IReadOnlyDictionary<string, IReadOnlyList<JsonElement>>> ReadWorkspaceAsync(CancellationToken cancellationToken = default)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync(cancellationToken);
        var workspace = await ReadWorkspaceAsync(connection, transaction, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return workspace;
    }

    private async Task<IReadOnlyDictionary<string, IReadOnlyList<JsonElement>>> ReadWorkspaceAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        CancellationToken cancellationToken)
    {
        var stores = new[] { "history", "collections", "environments", "settings" };
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT json FROM api_studio_data WHERE store = $store ORDER BY record_key";
        var storeParameter = command.Parameters.Add("$store", SqliteType.Text);
        var workspace = new Dictionary<string, IReadOnlyList<JsonElement>>(StringComparer.Ordinal);
        foreach (var store in stores)
        {
            storeParameter.Value = store;
            var values = new List<JsonElement>();
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                using var document = JsonDocument.Parse(reader.GetString(0));
                values.Add(UnprotectJson(document.RootElement));
            }
            workspace[store] = values;
        }
        return workspace;
    }
    public async Task<IReadOnlyDictionary<string, int>> ReplaceWorkspaceAsync(JsonElement backup, CancellationToken cancellationToken = default)
    {
        var stores = new[] { "history", "collections", "environments", "settings" };
        var limits = new Dictionary<string, int>(StringComparer.Ordinal)
        {
            ["history"] = 25000, ["collections"] = WorkspaceRecordLimit, ["environments"] = WorkspaceRecordLimit, ["settings"] = WorkspaceRecordLimit
        };
        if (backup.ValueKind != JsonValueKind.Object ||
            !backup.TryGetProperty("format", out var format) || format.ValueKind != JsonValueKind.String || format.GetString() != "api-studio-workspace" ||
            !backup.TryGetProperty("version", out var version) || version.ValueKind != JsonValueKind.Number || !version.TryGetInt32(out var versionNumber) || versionNumber != 1 ||
            !backup.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Object)
        {
            throw new ArgumentException("Backup inválido.", nameof(backup));
        }

        var entries = new List<(string Store, string Key, string Json)>();
        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var store in stores)
        {
            if (!data.TryGetProperty(store, out var records) || records.ValueKind != JsonValueKind.Array || records.GetArrayLength() > limits[store])
            {
                throw new ArgumentException("Backup inválido.", nameof(backup));
            }
            if ((store is "collections" or "environments") && records.GetArrayLength() == 0)
            {
                throw new ArgumentException("Backup precisa conter coleções e ambientes.", nameof(backup));
            }

            var keys = new HashSet<string>(StringComparer.Ordinal);
            foreach (var record in records.EnumerateArray())
            {
                string key;
                try { key = GetRecordKey(store, record); }
                catch (ArgumentException) { throw new ArgumentException("Backup inválido.", nameof(backup)); }
                if (key.Length > 512 || !keys.Add(key))
                {
                    throw new ArgumentException("Backup inválido.", nameof(backup));
                }
                entries.Add((store, key, ProtectJson(record).GetRawText()));
            }
            counts[store] = records.GetArrayLength();
        }

        await using var connection = await OpenAsync(cancellationToken);
        await using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "DELETE FROM api_studio_data WHERE store IN ('history', 'collections', 'environments', 'settings')";
        await command.ExecuteNonQueryAsync(cancellationToken);
        command.CommandText = "INSERT INTO api_studio_data(store, record_key, json) VALUES ($store, $key, $json)";
        var storeParameter = command.Parameters.Add("$store", SqliteType.Text);
        var keyParameter = command.Parameters.Add("$key", SqliteType.Text);
        var jsonParameter = command.Parameters.Add("$json", SqliteType.Text);
        foreach (var entry in entries)
        {
            storeParameter.Value = entry.Store;
            keyParameter.Value = entry.Key;
            jsonParameter.Value = entry.Json;
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
        await EnsureWorkspaceBackupFitsAsync(connection, transaction, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return counts;
    }

    private async Task EnsureWorkspaceBackupFitsAsync(SqliteConnection connection, SqliteTransaction transaction, CancellationToken cancellationToken)
    {
        if (_maxWorkspaceBackupBytes is not long limit) return;

        var data = await ReadWorkspaceAsync(connection, transaction, cancellationToken);
        if (data["history"].Count > 25000 || data["collections"].Count > WorkspaceRecordLimit ||
            data["environments"].Count > WorkspaceRecordLimit || data["settings"].Count > WorkspaceRecordLimit)
        {
            throw new WorkspaceSnapshotLimitExceededException();
        }

        var backup = new
        {
            format = WorkspaceBackupFormat,
            version = 1,
            exportedAt = WorkspaceBackupTimestampForSize,
            data
        };
        if (JsonSerializer.SerializeToUtf8Bytes(backup, WorkspaceBackupSizeJsonOptions).LongLength > limit)
        {
            throw new WorkspaceSnapshotLimitExceededException();
        }
    }

    public async Task<int> ProtectExistingSecretsAsync(CancellationToken cancellationToken = default)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync(cancellationToken);
        var records = new List<(string Store, string Key, string Json)>();
        await using (var read = connection.CreateCommand())
        {
            read.Transaction = transaction;
            read.CommandText = "SELECT store, record_key, json FROM api_studio_data ORDER BY store, record_key";
            await using var reader = await read.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                records.Add((reader.GetString(0), reader.GetString(1), reader.GetString(2)));
            }
        }

        await using var update = connection.CreateCommand();
        update.Transaction = transaction;
        update.CommandText = "UPDATE api_studio_data SET json = $json WHERE store = $store AND record_key = $key";
        var jsonParameter = update.Parameters.Add("$json", SqliteType.Text);
        var storeParameter = update.Parameters.Add("$store", SqliteType.Text);
        var keyParameter = update.Parameters.Add("$key", SqliteType.Text);
        var updated = 0;
        foreach (var record in records)
        {
            using var document = JsonDocument.Parse(record.Json);
            var protectedJson = ProtectJson(document.RootElement).GetRawText();
            if (string.Equals(record.Json, protectedJson, StringComparison.Ordinal)) continue;
            jsonParameter.Value = protectedJson;
            storeParameter.Value = record.Store;
            keyParameter.Value = record.Key;
            await update.ExecuteNonQueryAsync(cancellationToken);
            updated++;
        }
        await transaction.CommitAsync(cancellationToken);
        return updated;
    }

    private JsonElement ProtectJson(JsonElement value) => TransformJson(value, protect: true);

    private JsonElement UnprotectJson(JsonElement value) => TransformJson(value, protect: false);

    private JsonElement TransformJson(JsonElement value, bool protect)
    {
        var node = JsonNode.Parse(value.GetRawText());
        if (node is null || !TransformNode(node, protect)) return value.Clone();
        using var document = JsonDocument.Parse(node.ToJsonString());
        return document.RootElement.Clone();
    }

    private bool TransformNode(JsonNode? node, bool protect)
    {
        if (node is JsonObject objectNode)
        {
            var changed = false;
            foreach (var item in objectNode.ToArray())
            {
                if (item.Value is JsonValue jsonValue && jsonValue.TryGetValue<string>(out var text) && text is not null)
                {
                    var replacement = TransformValue(item.Key, text, protect, out var valueChanged);
                    if (valueChanged)
                    {
                        objectNode[item.Key] = replacement;
                        changed = true;
                    }
                }
                else if (TransformNode(item.Value, protect))
                {
                    changed = true;
                }
            }
            return changed;
        }

        if (node is JsonArray array)
        {
            var changed = false;
            foreach (var item in array.ToArray())
            {
                if (item is JsonArray pair && pair.Count == 2 &&
                    pair[0] is JsonValue nameNode && nameNode.TryGetValue<string>(out var name) && name is not null &&
                    pair[1] is JsonValue valueNode && valueNode.TryGetValue<string>(out var text) && text is not null)
                {
                    var replacement = TransformValue(name, text, protect, out var valueChanged);
                    if (valueChanged)
                    {
                        pair[1] = replacement;
                        changed = true;
                    }
                }
                else if (TransformNode(item, protect))
                {
                    changed = true;
                }
            }
            return changed;
        }

        return false;
    }

    private string TransformValue(string name, string value, bool protect, out bool changed)
    {
        changed = false;
        var protectedPrefix = value.StartsWith(ProtectedPrefix, StringComparison.Ordinal)
            ? ProtectedPrefix
            : value.StartsWith(LegacyProtectedPrefix, StringComparison.Ordinal) ? LegacyProtectedPrefix : null;
        if (protectedPrefix is not null)
        {
            if (!protect)
            {
                changed = true;
                try
                {
                    return _protector.Unprotect(value[protectedPrefix.Length..]);
                }
                catch (CryptographicException) when (name.Equals("tokenCredentialMode", StringComparison.OrdinalIgnoreCase))
                {
                    // This transport preference is not a secret; body is the safe default when its old key is unavailable.
                    Interlocked.Exchange(ref _tokenCredentialModeRecoveryWarning, 1);
                    return "body";
                }
            }
            return value;
        }

        if (!protect) return value;
        var shouldProtect = IsSensitiveName(name) ||
            (name.Equals("headers", StringComparison.OrdinalIgnoreCase) && ContainsSensitiveHeader(value)) ||
            (name.Equals("route", StringComparison.OrdinalIgnoreCase) && ContainsSensitiveQueryParameter(value)) ||
            (name.Equals("body", StringComparison.OrdinalIgnoreCase) && value.Length > 0);
        if (!shouldProtect || value.Length == 0) return value;

        changed = true;
        return ProtectedPrefix + _protector.Protect(value);
    }

    private static bool IsSensitiveName(string name)
    {
        var compact = new string(name.Where(char.IsLetterOrDigit).Select(char.ToLowerInvariant).ToArray());
        if (compact == "tokencredentialmode") return false;
        return new[] { "authorization", "auth", "bearer", "token", "secret", "password", "passwd", "basicusername", "senha", "credential", "cookie", "apikey", "privatekey" }
            .Any(part => compact.Contains(part, StringComparison.Ordinal));
    }

    private static bool ContainsSensitiveHeader(string headers) => headers.Split('\n').Any(line =>
    {
        var separator = line.IndexOf(':');
        return separator > 0 && IsSensitiveName(line[..separator].Trim());
    });

    private static bool ContainsSensitiveQueryParameter(string route)
    {
        var query = route.IndexOf('?');
        if (query < 0) return false;
        foreach (var pair in route[(query + 1)..].Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var separator = pair.IndexOf('=');
            var rawName = separator < 0 ? pair : pair[..separator];
            try
            {
                if (IsSensitiveName(Uri.UnescapeDataString(rawName.Replace('+', ' ')))) return true;
            }
            catch (UriFormatException) { return false; }
        }
        return false;
    }

    public async Task DeleteAsync(string store, string key, CancellationToken cancellationToken = default)
    {
        ValidateStore(store);
        await using var connection = await OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM api_studio_data WHERE store = $store AND record_key = $key";
        command.Parameters.AddWithValue("$store", store);
        command.Parameters.AddWithValue("$key", key);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    /// <summary>Removes the oldest history records while keeping the newest entries.</summary>
    /// <param name="limit">A maximum number of records to retain, from 1 to 5000.</param>
    /// <param name="cancellationToken">A token that cancels the operation.</param>
    /// <returns>The number of removed records.</returns>
    /// <exception cref="ArgumentOutOfRangeException">The requested limit is outside the supported range.</exception>
    public async Task<int> RetainHistoryAsync(int limit, CancellationToken cancellationToken = default)
    {
        if (limit is < 1 or > 5000) throw new ArgumentOutOfRangeException(nameof(limit));
        await using var connection = await OpenAsync(cancellationToken);
        await using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync(cancellationToken);
        var removed = await RetainHistoryAsync(connection, transaction, limit, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return removed;
    }

    private static async Task<int> RetainHistoryAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        int limit,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            DELETE FROM api_studio_data
            WHERE store = $store AND record_key NOT IN (
                SELECT record_key FROM api_studio_data
                WHERE store = $store
                ORDER BY json_extract(json, '$.savedAt') DESC, record_key DESC
                LIMIT $limit
            )
            """;
        command.Parameters.AddWithValue("$store", "history");
        command.Parameters.AddWithValue("$limit", limit);
        return await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task ClearAsync(string store, CancellationToken cancellationToken = default)
    {
        ValidateStore(store);
        await using var connection = await OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM api_studio_data WHERE store = $store";
        command.Parameters.AddWithValue("$store", store);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private async Task<SqliteConnection> OpenAsync(CancellationToken cancellationToken)
    {
        var connection = new SqliteConnection(_connectionString);
        try
        {
            await connection.OpenAsync(cancellationToken);
            return connection;
        }
        catch
        {
            await connection.DisposeAsync();
            throw;
        }
    }

    private static string GetRecordKey(string store, JsonElement value)
    {
        var property = store == "settings" ? "key" : "id";
        if (value.ValueKind != JsonValueKind.Object ||
            !value.TryGetProperty(property, out var key) ||
            key.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(key.GetString()))
        {
            throw new ArgumentException($"Registro de {store} sem {property} válido.", nameof(value));
        }

        return key.GetString()!;
    }

    private static void ValidateStore(string store)
    {
        if (!AllowedStores.Contains(store))
        {
            throw new ArgumentException("Tipo de armazenamento inválido.", nameof(store));
        }
    }
}

internal sealed class WorkspaceSnapshotLimitExceededException : Exception
{
    public WorkspaceSnapshotLimitExceededException()
        : base("A gravação excederia os limites do backup de recuperação hospedado (15 MiB ou quantidade máxima de registros). Remova dados ou respostas antigas do histórico e tente novamente.")
    {
    }
}

/// <summary>Indicates that hosted cookie storage quotas would be exceeded.</summary>
internal sealed class HostedCookieJarLimitExceededException : Exception
{
    /// <summary>Initializes a new instance of the <see cref="HostedCookieJarLimitExceededException"/> class.</summary>
    public HostedCookieJarLimitExceededException()
        : base("Os Cookie jars excedem o limite por sessão ou o limite compartilhado do serviço.")
    {
    }
}
