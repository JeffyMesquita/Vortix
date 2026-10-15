
using System.Net;
using System.Collections.Concurrent;
using System.Globalization;
using Microsoft.Data.Sqlite;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;

const long maxWorkspaceBackupBytes = 16 * 1024 * 1024;
var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
var port = builder.Configuration.GetValue("ApiStudio:Port", 51873);
if (port is < 1 or > 65535)
{
    throw new InvalidOperationException("ApiStudio:Port deve estar entre 1 e 65535.");
}

var databasePath = builder.Configuration["ApiStudio:DatabasePath"];
if (string.IsNullOrWhiteSpace(databasePath))
{
    var localDataPath = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
    databasePath = Path.Combine(string.IsNullOrWhiteSpace(localDataPath) ? AppContext.BaseDirectory : localDataPath,
        "ApiPublicacaoTester", "api-studio.sqlite");
}

builder.WebHost.ConfigureKestrel(options =>
{
    options.Limits.MaxRequestBodySize = 1_048_576;
    options.Listen(IPAddress.Loopback, port);
});

using var httpClient = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false })
{
    Timeout = TimeSpan.FromSeconds(30),
    MaxResponseContentBufferSize = 5 * 1024 * 1024
};

builder.Services.AddDataProtection().SetApplicationName("ApiPublicacaoTester");
var app = builder.Build();
var dataProtector = app.Services.GetRequiredService<IDataProtectionProvider>().CreateProtector("LocalDataStore.v1");
var localDataStore = new LocalDataStore(databasePath, dataProtector);
var cookieJarLocks = new ConcurrentDictionary<string, SemaphoreSlim>(StringComparer.Ordinal);
await localDataStore.InitializeAsync();
app.Use(async (context, next) =>
{
    context.Response.Headers["Cache-Control"] = "no-store";
    context.Response.Headers["Referrer-Policy"] = "no-referrer";
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["Content-Security-Policy"] = "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
    await next();
});
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapGet("/health", () => Results.Json(new { status = "ok", app = "ApiPublicacaoTester" }));
app.MapGet("/api/storage/{store}", async (HttpContext context, string store, string? key, CancellationToken cancellationToken) =>
{
    if (!IsTrustedLocalRequest(context, port)) return Results.StatusCode(StatusCodes.Status403Forbidden);
    try
    {
        if (key is null)
        {
            return Results.Json(await localDataStore.ReadAllAsync(store, cancellationToken));
        }

        var value = await localDataStore.ReadAsync(store, key, cancellationToken);
        return value.HasValue ? Results.Json(value.Value) : Results.Text("null", "application/json");
    }
    catch (ArgumentException)
    {
        return StorageError();
    }
});
app.MapGet("/api/storage/workspace", async (HttpContext context, CancellationToken cancellationToken) =>
{
    if (!IsTrustedLocalRequest(context, port)) return Results.StatusCode(StatusCodes.Status403Forbidden);
    return Results.Json(await localDataStore.ReadWorkspaceAsync(cancellationToken));
});app.MapPost("/api/storage/workspace/restore", async (HttpContext context, CancellationToken cancellationToken) =>
{
    if (!IsTrustedLocalRequest(context, port)) return Results.StatusCode(StatusCodes.Status403Forbidden);
    var requestLimit = context.Features.Get<Microsoft.AspNetCore.Http.Features.IHttpMaxRequestBodySizeFeature>();
    if (requestLimit is null || requestLimit.IsReadOnly) return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
    requestLimit.MaxRequestBodySize = maxWorkspaceBackupBytes;
    try
    {
        using var document = await JsonDocument.ParseAsync(context.Request.Body, cancellationToken: cancellationToken);
        var counts = await localDataStore.ReplaceWorkspaceAsync(document.RootElement, cancellationToken);
        return Results.Json(new { restored = true, counts });
    }
    catch (JsonException)
    {
        return Results.Json(new { error = "Arquivo de backup inválido." }, statusCode: StatusCodes.Status400BadRequest);
    }
    catch (ArgumentException)
    {
        return Results.Json(new { error = "Backup inválido ou incompatível." }, statusCode: StatusCodes.Status400BadRequest);
    }
});app.MapPost("/api/storage/{store}", async (HttpContext context, string store, JsonElement value, CancellationToken cancellationToken) =>
{
    if (!IsTrustedLocalRequest(context, port)) return Results.StatusCode(StatusCodes.Status403Forbidden);
    try
    {
        await localDataStore.WriteAsync(store, value, cancellationToken);
        return Results.NoContent();
    }
    catch (ArgumentException)
    {
        return StorageError();
    }
});

app.MapPost("/api/storage/security/protect-existing", async (HttpContext context, JsonElement confirmation, CancellationToken cancellationToken) =>
{
    if (!IsTrustedLocalRequest(context, port)) return Results.StatusCode(StatusCodes.Status403Forbidden);
    if (confirmation.ValueKind != JsonValueKind.Object ||
        !confirmation.TryGetProperty("confirm", out var confirmed) || confirmed.ValueKind != JsonValueKind.True)
    {
        return Results.Json(new { error = "Confirme a proteção dos dados antigos." }, statusCode: StatusCodes.Status400BadRequest);
    }
    try
    {
        var updated = await localDataStore.ProtectExistingSecretsAsync(cancellationToken);
        return Results.Json(new { updatedRecords = updated });
    }
    catch (CryptographicException)
    {
        return Results.Json(new { error = "Não foi possível proteger os segredos locais." }, statusCode: StatusCodes.Status500InternalServerError);
    }
});
app.MapPost("/api/storage/{store}/import", async (HttpContext context, string store, JsonElement values, CancellationToken cancellationToken) =>
{
    if (!IsTrustedLocalRequest(context, port)) return Results.StatusCode(StatusCodes.Status403Forbidden);
    try
    {
        var imported = await localDataStore.ImportLegacyBatchAsync(store, values, cancellationToken);
        return Results.Json(new { imported });
    }
    catch (ArgumentException)
    {
        return StorageError();
    }
});
app.MapDelete("/api/storage/{store}", async (HttpContext context, string store, string? key, CancellationToken cancellationToken) =>
{
    if (!IsTrustedLocalRequest(context, port)) return Results.StatusCode(StatusCodes.Status403Forbidden);
    try
    {
        if (key is null) await localDataStore.ClearAsync(store, cancellationToken);
        else await localDataStore.DeleteAsync(store, key, cancellationToken);
        return Results.NoContent();
    }
    catch (ArgumentException)
    {
        return StorageError();
    }
});
app.MapPost("/api/request", (HttpContext context, ApiCall call) => HandleRequest(context, call, httpClient, localDataStore, cookieJarLocks, port));
await app.RunAsync();

static async Task<IResult> HandleRequest(HttpContext context, ApiCall call, HttpClient httpClient, LocalDataStore localDataStore, ConcurrentDictionary<string, SemaphoreSlim> cookieJarLocks, int port)
{
    if (!IsTrustedLocalRequest(context, port))
    {
        return Results.StatusCode(StatusCodes.Status403Forbidden);
    }

    if (call is null || string.IsNullOrWhiteSpace(call.BaseUrl) || call.BaseUrl.Length > 2048 ||
        string.IsNullOrWhiteSpace(call.Route) || call.Route.Length > 4096 || (call.Body?.Length ?? 0) > 900_000 ||
        (call.Headers?.Length ?? 0) > 32_000 || (call.BearerToken?.Length ?? 0) > 8192 ||
        (call.TokenClientId?.Length ?? 0) > 512 || (call.TokenClientSecret?.Length ?? 0) > 8192 || (call.AuthType?.Length ?? 0) > 16 || (call.BasicUsername?.Length ?? 0) > 1024 || (call.BasicPassword?.Length ?? 0) > 8192 || (call.ApiKeyName?.Length ?? 0) > 128 || (call.ApiKeyLocation?.Length ?? 0) > 16 || (call.ApiKeyValue?.Length ?? 0) > 8192 || (call.BodyMode?.Length ?? 0) > 16 || (call.EnvironmentId?.Length ?? 0) > 128 || call.EnvironmentId?.Contains('\r') == true || call.EnvironmentId?.Contains('\n') == true)
    {
        return Error(StatusCodes.Status400BadRequest, "Revise URL, rota e tamanho dos campos.");
    }

    var environmentId = string.IsNullOrWhiteSpace(call.EnvironmentId) ? "default" : call.EnvironmentId.Trim();
    var cookieStorageKey = "cookiejar:" + environmentId;
    var providedAuthType = call.AuthType?.Trim() ?? string.Empty;
    var authType = providedAuthType.Length == 0
        ? (string.IsNullOrEmpty(call.BearerToken) ? "none" : "bearer")
        : providedAuthType.ToLowerInvariant();
    if (authType == "api-key") authType = "apikey";
    if (authType is not ("none" or "bearer" or "basic" or "apikey"))
    {
        return Error(StatusCodes.Status400BadRequest, "Tipo de autenticação não suportado.");
    }

    var basicUsername = call.BasicUsername ?? string.Empty;
    var basicPassword = call.BasicPassword ?? string.Empty;
    var apiKeyName = call.ApiKeyName ?? string.Empty;
    var apiKeyValue = call.ApiKeyValue ?? string.Empty;
    var apiKeyLocation = string.IsNullOrWhiteSpace(call.ApiKeyLocation) ? "header" : call.ApiKeyLocation.Trim().ToLowerInvariant();
    if (authType == "basic" &&
        (string.IsNullOrWhiteSpace(basicUsername) || basicUsername.Contains(':') ||
         basicUsername.Contains('\r') || basicUsername.Contains('\n') ||
         basicPassword.Contains('\r') || basicPassword.Contains('\n')))
    {
        return Error(StatusCodes.Status400BadRequest, "Revise o usuário e a senha de Basic Auth.");
    }
    if (authType == "apikey" &&
        (string.IsNullOrWhiteSpace(apiKeyName) || apiKeyValue.Length == 0 ||
         apiKeyName.Contains('\r') || apiKeyName.Contains('\n') ||
         apiKeyValue.Contains('\r') || apiKeyValue.Contains('\n') ||
         apiKeyLocation is not ("header" or "query")))
    {
        return Error(StatusCodes.Status400BadRequest, "Revise o nome, valor e local da API Key.");
    }
    if (authType == "apikey" && apiKeyLocation == "header" && !IsValidApiKeyHeaderName(apiKeyName))
    {
        return Error(StatusCodes.Status400BadRequest, "Nome de header da API Key inválido ou reservado.");
    }

    if (!Uri.TryCreate(call.BaseUrl.Trim(), UriKind.Absolute, out var baseUri) ||
        (baseUri.Scheme != Uri.UriSchemeHttps && baseUri.Scheme != Uri.UriSchemeHttp) ||
        !string.IsNullOrEmpty(baseUri.UserInfo) || !string.IsNullOrEmpty(baseUri.Query) ||
        !string.IsNullOrEmpty(baseUri.Fragment))
    {
        return Error(StatusCodes.Status400BadRequest, "URL base deve ser HTTP ou HTTPS, sem credenciais, query ou fragmento.");
    }

    if (baseUri.Scheme == Uri.UriSchemeHttp && !IsLoopbackHost(baseUri.Host) && !call.AllowInsecureHttp)
    {
        return Error(StatusCodes.Status400BadRequest, "HTTP fora de localhost exige autorização explícita na request; HTTPS é recomendado.");
    }

    var route = call.Route.Trim();
    var queryStart = route.IndexOf('?');
    var routePath = queryStart >= 0 ? route[..queryStart] : route;
    var decodedPath = Uri.UnescapeDataString(routePath);
    if (!route.StartsWith("/", StringComparison.Ordinal) || route.StartsWith("//", StringComparison.Ordinal) || route.Contains('\\') ||
        route.Contains('#') || route.Contains("://", StringComparison.Ordinal) ||
        decodedPath.Split('/').Any(segment => segment is "." or ".."))
    {
        return Error(StatusCodes.Status400BadRequest, "Rota deve começar com / e não pode trocar de host nem subir diretórios.");
    }

    var method = call.Method?.Trim().ToUpperInvariant() ?? string.Empty;
    if (method is not ("GET" or "HEAD" or "POST" or "PUT" or "PATCH" or "DELETE" or "OPTIONS"))
    {
        return Error(StatusCodes.Status400BadRequest, "Métodos disponíveis: GET, HEAD, POST, PUT, PATCH, DELETE e OPTIONS.");
    }

    var body = call.Body ?? string.Empty;
    var bodyMode = string.IsNullOrWhiteSpace(call.BodyMode) ? "json" : call.BodyMode.Trim().ToLowerInvariant();
    if (bodyMode is not ("json" or "text" or "xml" or "urlencoded" or "multipart" or "graphql"))
        return Error(StatusCodes.Status400BadRequest, "Modo de body não suportado.");
    if (bodyMode == "graphql" && method != "POST")
        return Error(StatusCodes.Status400BadRequest, "GraphQL usa POST no Vortix.");
    var contentTypeHeader = (call.Headers ?? string.Empty).Split('\n')
        .Select(line => line.Trim().TrimEnd('\r'))
        .FirstOrDefault(line => line.StartsWith("Content-Type:", StringComparison.OrdinalIgnoreCase));
    if (bodyMode == "multipart" && contentTypeHeader is not null)
        return Error(StatusCodes.Status400BadRequest, "Remova o Content-Type manual; o Vortix gera o boundary do multipart.");
    var tokenClientId = call.TokenClientId ?? string.Empty;
    var tokenClientSecret = call.TokenClientSecret ?? string.Empty;
    if ((method is "GET" or "HEAD" or "OPTIONS") &&
        (!string.IsNullOrWhiteSpace(body) || (bodyMode == "multipart" && call.MultipartFields is { Count: > 0 })))
    {
        return Error(StatusCodes.Status400BadRequest, "GET, HEAD e OPTIONS não enviam body.");
    }

    var isTokenRequest = call.ConfirmTokenRequest;

    if (isTokenRequest)
    {
        if (method != "POST" || bodyMode != "json" || !string.IsNullOrEmpty(body) ||
            call.TokenCredentialMode is not ("body" or "query") ||
            !IsValidTokenFieldName(call.TokenClientIdField) ||
            !IsValidTokenFieldName(call.TokenClientSecretField) ||
            string.Equals(call.TokenClientIdField, call.TokenClientSecretField, StringComparison.OrdinalIgnoreCase))
        {
            return Error(StatusCodes.Status400BadRequest, "Revise o método, modo e nomes dos campos de credenciais.");
        }
        if (string.IsNullOrWhiteSpace(tokenClientId) || string.IsNullOrWhiteSpace(tokenClientSecret))
        {
            return Error(StatusCodes.Status400BadRequest, "Informe os dois valores de credencial.");
        }
    } else if (IsWriteMethod(method))
    {
        if (!call.ConfirmTestData ||
            !string.Equals(call.TestDataPhrase?.Trim(), "TESTE", StringComparison.Ordinal))
        {
            return Error(StatusCodes.Status400BadRequest, "Confirme os dados de teste e digite TESTE antes de enviar.");
        }

        var contentTypeLine = (call.Headers ?? string.Empty).Split('\n')
            .Select(line => line.Trim().TrimEnd('\r'))
            .FirstOrDefault(line => line.StartsWith("Content-Type:", StringComparison.OrdinalIgnoreCase));
        var contentTypeValue = contentTypeLine is null ? DefaultBodyContentType(bodyMode) : contentTypeLine[(contentTypeLine.IndexOf(':') + 1)..].Trim();
        if (string.IsNullOrWhiteSpace(contentTypeValue)) contentTypeValue = DefaultBodyContentType(bodyMode);
        var expectsJson = MediaTypeHeaderValue.TryParse(contentTypeValue, out var requestContentType) &&
             (requestContentType.MediaType?.Equals("application/json", StringComparison.OrdinalIgnoreCase) == true ||
              requestContentType.MediaType?.EndsWith("+json", StringComparison.OrdinalIgnoreCase) == true);
        if (bodyMode == "graphql" && !expectsJson)
            return Error(StatusCodes.Status400BadRequest, "GraphQL exige Content-Type application/json.");
        if (bodyMode == "graphql" && string.IsNullOrWhiteSpace(body))
            return Error(StatusCodes.Status400BadRequest, "Informe a query GraphQL.");
        if (!string.IsNullOrWhiteSpace(body) && expectsJson)
        {
            try
            {
                using var requestBody = JsonDocument.Parse(body);
                if (bodyMode == "graphql")
                {
                    var root = requestBody.RootElement;
                    if (root.ValueKind != JsonValueKind.Object ||
                        !root.TryGetProperty("query", out var queryValue) ||
                        queryValue.ValueKind != JsonValueKind.String ||
                        string.IsNullOrWhiteSpace(queryValue.GetString()))
                        return Error(StatusCodes.Status400BadRequest, "O payload GraphQL precisa conter uma query não vazia.");
                    if (root.TryGetProperty("variables", out var variablesValue) && variablesValue.ValueKind != JsonValueKind.Object)
                        return Error(StatusCodes.Status400BadRequest, "Variables GraphQL precisam ser um objeto JSON.");
                    if (root.TryGetProperty("operationName", out var operationNameValue) && operationNameValue.ValueKind != JsonValueKind.String)
                        return Error(StatusCodes.Status400BadRequest, "OperationName GraphQL precisa ser texto.");
                }
            }
            catch (JsonException)
            {
                return Error(StatusCodes.Status400BadRequest, "O corpo deve ser JSON válido ou ficar vazio.");
            }
        }
    }

    var targetText = baseUri.AbsoluteUri.TrimEnd('/') + "/" + route.TrimStart('/');
    if (isTokenRequest && call.TokenCredentialMode == "query")
    {
        var separator = targetText.Contains('?') ? "&" : "?";
        targetText += separator + Uri.EscapeDataString(call.TokenClientIdField) + "=" + Uri.EscapeDataString(tokenClientId.Trim()) +
            "&" + Uri.EscapeDataString(call.TokenClientSecretField) + "=" + Uri.EscapeDataString(tokenClientSecret);
    }
    if (!Uri.TryCreate(targetText, UriKind.Absolute, out var targetUri))
    {
        return Error(StatusCodes.Status400BadRequest, "URL final inválida.");
    }

    if (authType == "apikey" && apiKeyLocation == "query")
    {
        if (ContainsQueryParameter(targetUri, apiKeyName))
        {
            return Error(StatusCodes.Status400BadRequest, "API Key já aparece nos Params da request.");
        }
        var builder = new UriBuilder(targetUri);
        var apiKeyPair = Uri.EscapeDataString(apiKeyName) + "=" + Uri.EscapeDataString(apiKeyValue);
        var existingQuery = builder.Query.TrimStart('?');
        builder.Query = existingQuery.Length == 0 ? apiKeyPair : existingQuery + "&" + apiKeyPair;
        targetUri = builder.Uri;
    }

    using var request = new HttpRequestMessage(new HttpMethod(method), targetUri);
    if (authType == "bearer")
    {
        var token = (call.BearerToken ?? string.Empty).Trim();
        if (token.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            token = token[7..].Trim();
        }
        if (token.Contains('\r') || token.Contains('\n'))
        {
            return Error(StatusCodes.Status400BadRequest, "Token Bearer inválido.");
        }
        if (token.Length > 0) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
    }
    else if (authType == "basic")
    {
        var encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes(basicUsername + ":" + basicPassword));
        request.Headers.Authorization = new AuthenticationHeaderValue("Basic", encoded);
    }
    if (isTokenRequest && call.TokenCredentialMode == "body")
    {
        var tokenCredentials = JsonSerializer.Serialize(new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [call.TokenClientIdField] = tokenClientId.Trim(),
            [call.TokenClientSecretField] = tokenClientSecret
        });
        request.Content = new ByteArrayContent(Encoding.UTF8.GetBytes(tokenCredentials));
    }
    else if (IsWriteMethod(method) && bodyMode == "multipart")
    {
        if (!TryCreateMultipartContent(call.MultipartFields ?? [], out var multipartContent, out var multipartError))
            return Error(StatusCodes.Status400BadRequest, multipartError);
        request.Content = multipartContent!;
    }
    else if (IsWriteMethod(method) && !string.IsNullOrWhiteSpace(body))
    {
        request.Content = new ByteArrayContent(Encoding.UTF8.GetBytes(body));
    }
    if (!TryApplyHeaders(call.Headers ?? string.Empty, request, out var headerError))
    {
        return Error(StatusCodes.Status400BadRequest, headerError);
    }
    if (request.Content is not null && request.Content.Headers.ContentType is null &&
        MediaTypeHeaderValue.TryParse(DefaultBodyContentType(bodyMode), out var defaultContentType))
    {
        defaultContentType.CharSet = "utf-8";
        request.Content.Headers.ContentType = defaultContentType;
    }

    if (authType == "apikey" && apiKeyLocation == "header")
    {
        if (request.Headers.Contains(apiKeyName) || (request.Content?.Headers.Contains(apiKeyName) ?? false))
        {
            return Error(StatusCodes.Status400BadRequest, "Header da API Key já aparece na request.");
        }
        if (!request.Headers.TryAddWithoutValidation(apiKeyName, apiKeyValue))
        {
            return Error(StatusCodes.Status400BadRequest, "Não foi possível aplicar o header da API Key.");
        }
    }

    return await SendWithCookieJarAsync(context, request, httpClient, localDataStore, cookieJarLocks, cookieStorageKey, targetUri);

}


static async Task<IResult> SendWithCookieJarAsync(
    HttpContext context,
    HttpRequestMessage request,
    HttpClient httpClient,
    LocalDataStore localDataStore,
    ConcurrentDictionary<string, SemaphoreSlim> cookieJarLocks,
    string cookieStorageKey,
    Uri targetUri)
{
    var cookieLock = cookieJarLocks.GetOrAdd(cookieStorageKey, static _ => new SemaphoreSlim(1, 1));
    await cookieLock.WaitAsync(context.RequestAborted);
    try
    {
        var cookieLoad = await ReadCookieJarAsync(localDataStore, cookieStorageKey, context.RequestAborted);
        var cookies = cookieLoad.Cookies;
        var cookieContainer = CreateCookieContainer(cookies);
        var outgoingCookieHeader = cookieContainer.GetCookieHeader(targetUri);
        if (outgoingCookieHeader.Length > 0)
            request.Headers.TryAddWithoutValidation("Cookie", outgoingCookieHeader);

        using var response = await httpClient.SendAsync(request, HttpCompletionOption.ResponseContentRead, context.RequestAborted);
        var responseBody = await response.Content.ReadAsStringAsync(context.RequestAborted);
        var responseHeaders = new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase);
        foreach (var header in response.Headers)
            responseHeaders[header.Key] = header.Value.ToArray();
        foreach (var header in response.Content.Headers)
            responseHeaders[header.Key] = header.Value.ToArray();

        var cookieJarWarning = string.Empty;
        var setCookieHeaders = response.Headers.TryGetValues("Set-Cookie", out var values) ? values.ToArray() : [];
        if (setCookieHeaders.Length > 0 || cookieLoad.PrunedExpired)
        {
            if (setCookieHeaders.Length > 0)
                cookies = UpdateCookieJar(cookieContainer, cookies, targetUri, setCookieHeaders);
            try
            {
                await WriteCookieJarAsync(localDataStore, cookieStorageKey, cookies, context.RequestAborted);
            }
            catch (Exception error) when (error is SqliteException or CryptographicException or JsonException or InvalidOperationException or ArgumentException)
            {
                cookieJarWarning = "A resposta chegou, mas o Cookie jar não foi atualizado no SQLite local.";
            }
        }

        return Results.Json(new
        {
            status = (int)response.StatusCode,
            reason = response.ReasonPhrase ?? string.Empty,
            headers = responseHeaders,
            body = responseBody,
            cookieJarWarning
        });
    }
    catch (OperationCanceledException) when (!context.RequestAborted.IsCancellationRequested)
    {
        return Error(StatusCodes.Status504GatewayTimeout, "Tempo limite da API: 30 segundos.");
    }
    catch (OperationCanceledException)
    {
        return Results.StatusCode(499);
    }
    catch (HttpRequestException)
    {
        return Error(StatusCodes.Status502BadGateway, "Falha de rede, TLS ou conexão com a API. Confira URL e disponibilidade.");
    }
    catch (InvalidOperationException)
    {
        return Error(StatusCodes.Status502BadGateway, "Resposta da API excedeu o limite ou não pôde ser lida.");
    }
    finally
    {
        cookieLock.Release();
    }
}

static async Task<CookieJarLoad> ReadCookieJarAsync(LocalDataStore localDataStore, string storageKey, CancellationToken cancellationToken)
{
    var record = await localDataStore.ReadAsync("settings", storageKey, cancellationToken);
    if (!record.HasValue || record.Value.ValueKind != JsonValueKind.Object ||
        !record.Value.TryGetProperty("value", out var value) ||
        !value.TryGetProperty("cookies", out var cookieArray) ||
        cookieArray.ValueKind != JsonValueKind.Array)
        return new CookieJarLoad([], false);

    var stored = JsonSerializer.Deserialize<List<StoredCookie>>(cookieArray.GetRawText(), new JsonSerializerOptions(JsonSerializerDefaults.Web)) ?? [];
    var active = stored.Where(cookie => !cookie.ExpiresUtc.HasValue || cookie.ExpiresUtc.Value > DateTimeOffset.UtcNow).ToList();
    return new CookieJarLoad(active, active.Count != stored.Count);
}

static CookieContainer CreateCookieContainer(IEnumerable<StoredCookie> cookies)
{
    var container = new CookieContainer();
    foreach (var stored in cookies)
    {
        if (!Uri.TryCreate(stored.CookieOrigin, UriKind.Absolute, out var origin)) continue;
        try { container.SetCookies(origin, stored.CookieHeader); }
        catch (CookieException) { }
    }
    return container;
}

static List<StoredCookie> UpdateCookieJar(CookieContainer container, IEnumerable<StoredCookie> current, Uri origin, IEnumerable<string> setCookieHeaders)
{
    var cookies = new Dictionary<string, StoredCookie>(StringComparer.Ordinal);
    foreach (var cookie in current)
        if (!cookie.ExpiresUtc.HasValue || cookie.ExpiresUtc.Value > DateTimeOffset.UtcNow)
            cookies[CookieIdentity(cookie.CookieName, cookie.CookieDomain, cookie.CookiePath)] = cookie;

    foreach (var header in setCookieHeaders)
    {
        if (!TryNormalizeSetCookie(header, origin, out var cookie, out var identity, out var expired)) continue;
        try { container.SetCookies(origin, cookie.CookieHeader); }
        catch (CookieException) { continue; }
        if (expired) cookies.Remove(identity);
        else if (cookies.ContainsKey(identity) || cookies.Count < 300) cookies[identity] = cookie;
    }

    return cookies.Values
        .Where(cookie => !cookie.ExpiresUtc.HasValue || cookie.ExpiresUtc.Value > DateTimeOffset.UtcNow)
        .OrderBy(cookie => cookie.CookieDomain, StringComparer.OrdinalIgnoreCase)
        .ThenBy(cookie => cookie.CookiePath, StringComparer.Ordinal)
        .ThenBy(cookie => cookie.CookieName, StringComparer.Ordinal)
        .ToList();
}

static bool TryNormalizeSetCookie(string header, Uri origin, out StoredCookie cookie, out string identity, out bool expired)
{
    cookie = new StoredCookie();
    identity = string.Empty;
    expired = false;
    if (header.Length is 0 or > 8192) return false;
    var parts = header.Split(';', StringSplitOptions.TrimEntries);
    if (parts.Length == 0) return false;
    var separator = parts[0].IndexOf('=');
    if (separator <= 0) return false;
    var name = parts[0][..separator].Trim();
    if (name.Length == 0) return false;

    var attributes = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
    foreach (var part in parts.Skip(1))
    {
        if (part.Length == 0) continue;
        var equals = part.IndexOf('=');
        attributes[(equals < 0 ? part : part[..equals]).Trim()] = equals < 0 ? null : part[(equals + 1)..].Trim();
    }

    var hasDomain = attributes.TryGetValue("domain", out var rawDomain) && !string.IsNullOrWhiteSpace(rawDomain);
    var domain = hasDomain ? rawDomain!.Trim().TrimStart('.').ToLowerInvariant() : origin.IdnHost.ToLowerInvariant();
    var path = attributes.TryGetValue("path", out var rawPath) && rawPath?.StartsWith('/') == true
        ? rawPath
        : DefaultCookiePath(origin.AbsolutePath);
    var sameSite = attributes.TryGetValue("samesite", out var rawSameSite) ? rawSameSite ?? string.Empty : string.Empty;
    var secure = attributes.ContainsKey("secure");
    var httpOnly = attributes.ContainsKey("httponly");
    DateTimeOffset? expiresUtc = null;
    var hasMaxAge = attributes.TryGetValue("max-age", out var rawMaxAge);
    if (hasMaxAge && long.TryParse(rawMaxAge, NumberStyles.Integer, CultureInfo.InvariantCulture, out var maxAge))
    {
        if (maxAge <= 0) expired = true;
        else
        {
            try { expiresUtc = DateTimeOffset.UtcNow.AddSeconds(Math.Min(maxAge, 315_360_000)); }
            catch (ArgumentOutOfRangeException) { expiresUtc = DateTimeOffset.MaxValue; }
        }
    }
    else if (attributes.TryGetValue("expires", out var rawExpires) &&
        DateTimeOffset.TryParse(rawExpires, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var parsedExpires))
    {
        expiresUtc = parsedExpires;
        expired = parsedExpires <= DateTimeOffset.UtcNow;
    }

    var normalizedParts = new List<string> { parts[0] };
    foreach (var part in parts.Skip(1))
    {
        var attributeName = part.Split('=', 2)[0].Trim();
        if (attributeName.Equals("max-age", StringComparison.OrdinalIgnoreCase)) continue;
        if (hasMaxAge && attributeName.Equals("expires", StringComparison.OrdinalIgnoreCase)) continue;
        normalizedParts.Add(part);
    }
    if (hasMaxAge && expiresUtc.HasValue)
        normalizedParts.Add("Expires=" + expiresUtc.Value.UtcDateTime.ToString("R", CultureInfo.InvariantCulture));
    if (expired && hasMaxAge)
        normalizedParts.Add("Expires=Thu, 01 Jan 1970 00:00:00 GMT");

    var normalizedHeader = string.Join("; ", normalizedParts);
    cookie = new StoredCookie
    {
        CookieName = name,
        CookieDomain = domain,
        CookiePath = path,
        CookieOrigin = origin.GetLeftPart(UriPartial.Authority),
        CookieHeader = normalizedHeader,
        HostOnly = !hasDomain,
        Secure = secure,
        HttpOnly = httpOnly,
        SameSite = sameSite,
        ExpiresUtc = expiresUtc
    };
    identity = CookieIdentity(name, domain, path);
    return true;
}

static string DefaultCookiePath(string requestPath)
{
    if (string.IsNullOrEmpty(requestPath) || !requestPath.StartsWith('/') || requestPath == "/") return "/";
    var lastSlash = requestPath.LastIndexOf('/');
    return lastSlash <= 0 ? "/" : requestPath[..lastSlash];
}

static string CookieIdentity(string name, string domain, string path) =>
    name + "\0" + domain.TrimStart('.').ToLowerInvariant() + "\0" + path;

static async Task WriteCookieJarAsync(LocalDataStore localDataStore, string storageKey, IReadOnlyList<StoredCookie> cookies, CancellationToken cancellationToken)
{
    if (cookies.Count == 0)
    {
        await localDataStore.DeleteAsync("settings", storageKey, cancellationToken);
        return;
    }
    var record = JsonSerializer.SerializeToElement(new { key = storageKey, value = new { cookies } }, new JsonSerializerOptions(JsonSerializerDefaults.Web));
    await localDataStore.WriteAsync("settings", record, cancellationToken);
}

static bool IsTrustedLocalRequest(HttpContext context, int port)
{
    var origin = context.Request.Headers["Origin"].ToString();
    var sameOrigin = string.Equals(origin, $"http://127.0.0.1:{port}", StringComparison.OrdinalIgnoreCase);
    // Browsers omit Origin on same-origin GET fetches; keep writes and proxy calls origin-checked.
    var safeReadWithoutOrigin = origin.Length == 0 && HttpMethods.IsGet(context.Request.Method);
    return string.Equals(context.Request.Headers["X-Api-Studio"].ToString(), "1", StringComparison.Ordinal) &&
        (sameOrigin || safeReadWithoutOrigin) &&
        string.Equals(context.Request.Host.Value, $"127.0.0.1:{port}", StringComparison.OrdinalIgnoreCase);
}

static IResult StorageError() => Results.Json(new { error = "Registro local inválido." }, statusCode: StatusCodes.Status400BadRequest);

static bool IsWriteMethod(string method) => method is "POST" or "PUT" or "PATCH" or "DELETE";

static string DefaultBodyContentType(string bodyMode) => bodyMode switch
{
    "text" => "text/plain",
    "xml" => "application/xml",
    "urlencoded" => "application/x-www-form-urlencoded",
    "multipart" => "multipart/form-data",
    "graphql" => "application/json",
    _ => "application/json"
};

static bool TryCreateMultipartContent(List<MultipartField>? fields, out MultipartFormDataContent? content, out string error)
{
    content = null;
    error = "Campo multipart inválido.";
    fields ??= [];
    if (fields.Count > 100)
    {
        error = "Multipart aceita até 100 campos.";
        return false;
    }
    var multipart = new MultipartFormDataContent();
    var totalTextBytes = 0;
    var totalFileBytes = 0;
    foreach (var field in fields)
    {
        if (field is null)
        {
            multipart.Dispose();
            error = "Campo multipart inválido.";
            return false;
        }
        var name = field.Name?.Trim() ?? string.Empty;
        var type = field.Type?.Trim().ToLowerInvariant() ?? string.Empty;
        if (name.Length is 0 or > 256 || name.Contains('\r') || name.Contains('\n'))
        {
            multipart.Dispose();
            error = "Informe um nome válido para cada campo multipart.";
            return false;
        }

        if (type == "text")
        {
            var value = field.Value ?? string.Empty;
            totalTextBytes += Encoding.UTF8.GetByteCount(value);
            if (value.Length > 262_144 || totalTextBytes > 1_048_576)
            {
                multipart.Dispose();
                error = "Campos multipart de texto ultrapassam o limite de 1 MB.";
                return false;
            }
            multipart.Add(new StringContent(value, Encoding.UTF8), name);
            continue;
        }

        if (type != "file")
        {
            multipart.Dispose();
            error = "Tipo de campo multipart não suportado.";
            return false;
        }

        var fileName = (field.FileName ?? string.Empty).Replace('\\', '/').Split('/').Last().Trim();
        var encoded = field.FileBase64 ?? string.Empty;
        if (fileName.Length is 0 or > 255 || fileName.Contains('\r') || fileName.Contains('\n') || encoded.Length > 13_981_016)
        {
            multipart.Dispose();
            error = "Nome ou tamanho de arquivo multipart inválido.";
            return false;
        }

        byte[] fileBytes;
        try { fileBytes = Convert.FromBase64String(encoded); }
        catch (FormatException)
        {
            multipart.Dispose();
            error = "Conteúdo do arquivo multipart inválido.";
            return false;
        }
        totalFileBytes += fileBytes.Length;
        if (totalFileBytes > 10 * 1024 * 1024)
        {
            multipart.Dispose();
            error = "Arquivos multipart ultrapassam o limite total de 10 MB.";
            return false;
        }

        var mediaType = string.IsNullOrWhiteSpace(field.ContentType) ? "application/octet-stream" : field.ContentType.Trim();
        if (mediaType.Length > 200 || mediaType.Contains('\r') || mediaType.Contains('\n') || !MediaTypeHeaderValue.TryParse(mediaType, out var parsedMediaType))
        {
            multipart.Dispose();
            error = "Content-Type do arquivo multipart inválido.";
            return false;
        }
        var fileContent = new ByteArrayContent(fileBytes);
        fileContent.Headers.ContentType = parsedMediaType;
        multipart.Add(fileContent, name, fileName);
    }

    content = multipart;
    error = string.Empty;
    return true;
}

static bool IsValidTokenFieldName(string? value) =>
    value is { Length: > 0 and <= 128 } && char.IsAsciiLetter(value[0]) &&
    value.All(character => char.IsAsciiLetterOrDigit(character) || character is '_' or '-' or '.');

static bool IsValidApiKeyHeaderName(string value) =>
    value.Length is > 0 and <= 128 &&
    value.All(character =>
        char.IsAsciiLetterOrDigit(character) ||
        "!#$%&'*+-.^_|~".Contains(character) ||
        character == (char)96) &&
    !new[] { "Authorization", "Proxy-Authorization", "Host", "Content-Length", "Transfer-Encoding", "Content-Type", "Cookie" }
        .Contains(value, StringComparer.OrdinalIgnoreCase);

static bool ContainsQueryParameter(Uri uri, string name)
{
    foreach (var pair in uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
    {
        var separator = pair.IndexOf('=');
        var rawName = separator < 0 ? pair : pair[..separator];
        try
        {
            if (Uri.UnescapeDataString(rawName.Replace('+', ' ')).Equals(name, StringComparison.OrdinalIgnoreCase)) return true;
        }
        catch (UriFormatException) { return false; }
    }

    return false;
}

static IResult Error(int status, string message) => Results.Json(new { error = message }, statusCode: status);

static bool IsLoopbackHost(string host) =>
    string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase) ||
    (IPAddress.TryParse(host, out var address) && IPAddress.IsLoopback(address));

static bool TryApplyHeaders(string text, HttpRequestMessage request, out string error)
{
    error = "Cabeçalho inválido. Use uma linha Nome: valor por cabeçalho.";
    foreach (var rawLine in text.Split('\n'))
    {
        var line = rawLine.TrimEnd('\r').Trim();
        if (line.Length == 0)
        {
            continue;
        }

        var separator = line.IndexOf(':');
        if (separator <= 0)
        {
            return false;
        }

        var name = line[..separator].Trim();
        var value = line[(separator + 1)..].Trim();
        if (value.Contains('\r') || value.Contains('\n') ||
            name.Equals("Authorization", StringComparison.OrdinalIgnoreCase) ||
            name.Equals("Host", StringComparison.OrdinalIgnoreCase) ||
            name.Equals("Content-Length", StringComparison.OrdinalIgnoreCase) ||
            name.Equals("Transfer-Encoding", StringComparison.OrdinalIgnoreCase))
        {
            error = "Authorization usa o campo Bearer; Host e cabeçalhos de transporte são bloqueados.";
            return false;
        }

        if (name.Equals("Content-Type", StringComparison.OrdinalIgnoreCase))
        {
            if (!MediaTypeHeaderValue.TryParse(value, out var contentType))
            {
                return false;
            }

            request.Content ??= new ByteArrayContent(Array.Empty<byte>());
            request.Content.Headers.ContentType = contentType;
            continue;
        }
        if (!request.Headers.TryAddWithoutValidation(name, value) &&
            (request.Content is null || !request.Content.Headers.TryAddWithoutValidation(name, value)))
        {
            return false;
        }
    }

    return true;
}


sealed record CookieJarLoad(List<StoredCookie> Cookies, bool PrunedExpired);

sealed record StoredCookie
{
    public string CookieName { get; init; } = string.Empty;
    public string CookieDomain { get; init; } = string.Empty;
    public string CookiePath { get; init; } = "/";
    public string CookieOrigin { get; init; } = string.Empty;
    public string CookieHeader { get; init; } = string.Empty;
    public bool HostOnly { get; init; }
    public bool Secure { get; init; }
    public bool HttpOnly { get; init; }
    public string SameSite { get; init; } = string.Empty;
    public DateTimeOffset? ExpiresUtc { get; init; }
}
sealed class MultipartField
{
    public string Name { get; init; } = string.Empty;
    public string Type { get; init; } = "text";
    public string Value { get; init; } = string.Empty;
    public string FileName { get; init; } = string.Empty;
    public string ContentType { get; init; } = string.Empty;
    public string FileBase64 { get; init; } = string.Empty;
}
sealed class ApiCall
{
    /// <summary>Gets or sets the authentication type used for the outgoing API request.</summary>
    /// <value>One of <c>none</c>, <c>bearer</c>, <c>basic</c>, or <c>apiKey</c>. An empty value preserves legacy Bearer requests.</value>
    public string AuthType { get; init; } = string.Empty;
    /// <summary>Gets or sets the HTTP Basic username.</summary>
    /// <value>The username consumed when <see cref="AuthType"/> is <c>basic</c>.</value>
    public string BasicUsername { get; init; } = string.Empty;
    /// <summary>Gets or sets the HTTP Basic password.</summary>
    /// <value>The password consumed when <see cref="AuthType"/> is <c>basic</c>.</value>
    public string BasicPassword { get; init; } = string.Empty;
    /// <summary>Gets or sets the API Key name.</summary>
    /// <value>A header name or query parameter name.</value>
    public string ApiKeyName { get; init; } = string.Empty;
    /// <summary>Gets or sets where the API Key is sent.</summary>
    /// <value>Either <c>header</c> or <c>query</c>.</value>
    public string ApiKeyLocation { get; init; } = "header";
    /// <summary>Gets or sets the API Key value.</summary>
    /// <value>The credential consumed when <see cref="AuthType"/> is <c>apiKey</c>.</value>
    public string ApiKeyValue { get; init; } = string.Empty;
    /// <summary>Gets or sets the active local environment used to scope persisted cookies.</summary>
    /// <value>A local environment identifier; empty values use the default scope.</value>
    public string EnvironmentId { get; init; } = string.Empty;
    public string BaseUrl { get; init; } = string.Empty;
    public string Route { get; init; } = string.Empty;
    public string Method { get; init; } = "GET";
    public string BearerToken { get; init; } = string.Empty;
    public string Headers { get; init; } = string.Empty;
    /// <summary>Gets or sets the request body format.</summary>
    /// <value>One of <c>json</c>, <c>text</c>, <c>xml</c>, <c>urlencoded</c>, or <c>multipart</c>; empty preserves JSON defaults.</value>
    public string BodyMode { get; init; } = "json";
    public string Body { get; init; } = string.Empty;
    public List<MultipartField>? MultipartFields { get; init; } = [];
    public bool ConfirmTestData { get; init; }
    public string TestDataPhrase { get; init; } = string.Empty;
    public bool ConfirmTokenRequest { get; init; }
    public string TokenClientId { get; init; } = string.Empty;
    public string TokenClientSecret { get; init; } = string.Empty;
    public string TokenCredentialMode { get; init; } = "body";
    public string TokenClientIdField { get; init; } = "client_id";
    public string TokenClientSecretField { get; init; } = "client_secret";
    public bool AllowInsecureHttp { get; init; }

}
