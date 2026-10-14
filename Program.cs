
using System.Net;
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

using var httpClient = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false })
{
    Timeout = TimeSpan.FromSeconds(30),
    MaxResponseContentBufferSize = 5 * 1024 * 1024
};

builder.Services.AddDataProtection().SetApplicationName("ApiPublicacaoTester");
var app = builder.Build();
var dataProtector = app.Services.GetRequiredService<IDataProtectionProvider>().CreateProtector("LocalDataStore.v1");
var localDataStore = new LocalDataStore(databasePath, dataProtector);
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
app.MapPost("/api/request", (HttpContext context, ApiCall call) => HandleRequest(context, call, httpClient, port));
await app.RunAsync();

static async Task<IResult> HandleRequest(HttpContext context, ApiCall call, HttpClient httpClient, int port)
{
    if (!IsTrustedLocalRequest(context, port))
    {
        return Results.StatusCode(StatusCodes.Status403Forbidden);
    }

    if (call is null || string.IsNullOrWhiteSpace(call.BaseUrl) || call.BaseUrl.Length > 2048 ||
        string.IsNullOrWhiteSpace(call.Route) || call.Route.Length > 4096 || (call.Body?.Length ?? 0) > 900_000 ||
        (call.Headers?.Length ?? 0) > 32_000 || (call.BearerToken?.Length ?? 0) > 8192 ||
        (call.TokenClientId?.Length ?? 0) > 512 || (call.TokenClientSecret?.Length ?? 0) > 8192)
    {
        return Error(StatusCodes.Status400BadRequest, "Revise URL, rota e tamanho dos campos.");
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
    var tokenClientId = call.TokenClientId ?? string.Empty;
    var tokenClientSecret = call.TokenClientSecret ?? string.Empty;
    if ((method is "GET" or "HEAD" or "OPTIONS") && !string.IsNullOrWhiteSpace(body))
    {
        return Error(StatusCodes.Status400BadRequest, "GET não envia JSON; limpe o corpo da requisição.");
    }

    var isTokenRequest = call.ConfirmTokenRequest;

    if (isTokenRequest)
    {
        if (method != "POST" || !string.IsNullOrEmpty(body) ||
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
        var contentTypeValue = contentTypeLine is null ? string.Empty : contentTypeLine[(contentTypeLine.IndexOf(':') + 1)..].Trim();
        var expectsJson = string.IsNullOrWhiteSpace(contentTypeValue) ||
            (MediaTypeHeaderValue.TryParse(contentTypeValue, out var requestContentType) &&
             (requestContentType.MediaType?.Equals("application/json", StringComparison.OrdinalIgnoreCase) == true ||
              requestContentType.MediaType?.EndsWith("+json", StringComparison.OrdinalIgnoreCase) == true));
        if (!string.IsNullOrWhiteSpace(body) && expectsJson)
        {
            try
            {
                using var requestBody = JsonDocument.Parse(body);
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

    var token = (call.BearerToken ?? string.Empty).Trim();
    if (token.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
    {
        token = token[7..].Trim();
    }
    if (token.Contains('\r') || token.Contains('\n'))
    {
        return Error(StatusCodes.Status400BadRequest, "Token Bearer inválido.");
    }

    using var request = new HttpRequestMessage(new HttpMethod(method), targetUri);
    if (token.Length > 0)
    {
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
    }
    if (isTokenRequest && call.TokenCredentialMode == "body")
    {
        var tokenCredentials = JsonSerializer.Serialize(new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [call.TokenClientIdField] = tokenClientId.Trim(),
            [call.TokenClientSecretField] = tokenClientSecret
        });
        request.Content = new StringContent(tokenCredentials, Encoding.UTF8, "application/json");
    }
    else if (IsWriteMethod(method) && !string.IsNullOrWhiteSpace(body))
    {
        request.Content = new StringContent(body, Encoding.UTF8, "application/json");
    }
    if (!TryApplyHeaders(call.Headers ?? string.Empty, request, out var headerError))
    {
        return Error(StatusCodes.Status400BadRequest, headerError);
    }

    try
    {
        using var response = await httpClient.SendAsync(request, HttpCompletionOption.ResponseContentRead, context.RequestAborted);
        var responseBody = await response.Content.ReadAsStringAsync(context.RequestAborted);
        var responseHeaders = new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase);
        foreach (var header in response.Headers)
        {
            responseHeaders[header.Key] = header.Value.ToArray();
        }
        foreach (var header in response.Content.Headers)
        {
            responseHeaders[header.Key] = header.Value.ToArray();
        }

        return Results.Json(new
        {
            status = (int)response.StatusCode,
            reason = response.ReasonPhrase ?? string.Empty,
            headers = responseHeaders,
            body = responseBody
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

static bool IsValidTokenFieldName(string? value) =>
    value is { Length: > 0 and <= 128 } && char.IsAsciiLetter(value[0]) &&
    value.All(character => char.IsAsciiLetterOrDigit(character) || character is '_' or '-' or '.');

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

sealed class ApiCall
{
    public string BaseUrl { get; init; } = string.Empty;
    public string Route { get; init; } = string.Empty;
    public string Method { get; init; } = "GET";
    public string BearerToken { get; init; } = string.Empty;
    public string Headers { get; init; } = string.Empty;
    public string Body { get; init; } = string.Empty;
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
