using Microsoft.Data.Sqlite;
using Microsoft.AspNetCore.DataProtection;
using System.Security.Cryptography;
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
    private readonly string _connectionString;
    private readonly IDataProtector _protector;
    private int _tokenCredentialModeRecoveryWarning;

    public LocalDataStore(string databasePath, IDataProtector protector)
    {
        _protector = protector;
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

    public async Task WriteAsync(string store, JsonElement value, CancellationToken cancellationToken = default)
    {
        ValidateStore(store);
        var key = GetRecordKey(store, value);
        await using var connection = await OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO api_studio_data(store, record_key, json) VALUES ($store, $key, $json)
            ON CONFLICT(store, record_key) DO UPDATE SET json = excluded.json
            """;
        command.Parameters.AddWithValue("$store", store);
        command.Parameters.AddWithValue("$key", key);
        command.Parameters.AddWithValue("$json", ProtectJson(value).GetRawText());
        await command.ExecuteNonQueryAsync(cancellationToken);
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

        await transaction.CommitAsync(cancellationToken);
        return inserted;
    }

    public async Task<IReadOnlyDictionary<string, IReadOnlyList<JsonElement>>> ReadWorkspaceAsync(CancellationToken cancellationToken = default)
    {
        var stores = new[] { "history", "collections", "environments", "settings" };
        await using var connection = await OpenAsync(cancellationToken);
        await using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync(cancellationToken);
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
        await transaction.CommitAsync(cancellationToken);
        return workspace;
    }
    public async Task<IReadOnlyDictionary<string, int>> ReplaceWorkspaceAsync(JsonElement backup, CancellationToken cancellationToken = default)
    {
        var stores = new[] { "history", "collections", "environments", "settings" };
        var limits = new Dictionary<string, int>(StringComparer.Ordinal)
        {
            ["history"] = 25000, ["collections"] = 1000, ["environments"] = 1000, ["settings"] = 1000
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
        await transaction.CommitAsync(cancellationToken);
        return counts;
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
        await using var command = connection.CreateCommand();
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
