
using System.Net;
using System.Collections.Concurrent;
using System.Globalization;
using Microsoft.Data.Sqlite;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Security.Cryptography;
using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.DataProtection;

const long maxWorkspaceBackupBytes = 15 * 1024 * 1024;
const string graphqlIntrospectionQuery = """
    query VortixSchemaIntrospection {
      __schema {
        queryType { name }
        mutationType { name }
        subscriptionType { name }
        types {
          ...FullType
        }
      }
    }
    fragment FullType on __Type {
      kind
      name
      description
      fields(includeDeprecated: true) {
        name
        description
        args { ...InputValue }
        type { ...TypeRef }
        isDeprecated
        deprecationReason
      }
      inputFields { ...InputValue }
      interfaces { ...TypeRef }
      enumValues(includeDeprecated: true) {
        name
        description
        isDeprecated
        deprecationReason
      }
      possibleTypes { ...TypeRef }
    }
    fragment InputValue on __InputValue {
      name
      description
      type { ...TypeRef }
      defaultValue
    }
    fragment TypeRef on __Type {
      kind
      name
      ofType {
        kind
        name
        ofType {
          kind
          name
          ofType {
            kind
            name
            ofType { kind name ofType { kind name ofType { kind name } } }
          }
        }
      }
    }
    """;
var graphqlIntrospectionBody = JsonSerializer.Serialize(new { query = graphqlIntrospectionQuery, operationName = "VortixSchemaIntrospection" });
var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
var hostingMode = (builder.Configuration["ApiStudio:HostingMode"] ?? "local").Trim().ToLowerInvariant();
if (hostingMode is not ("local" or "render"))
{
    throw new InvalidOperationException("ApiStudio:HostingMode aceita somente local ou render.");
}
var hostedMode = hostingMode == "render";
var publicOrigin = string.Empty;
var accessPassword = builder.Configuration["ApiStudio:AccessPassword"] ?? string.Empty;
if (hostedMode)
{
    var configuredOrigin = builder.Configuration["ApiStudio:PublicOrigin"];
    if (!Uri.TryCreate(configuredOrigin, UriKind.Absolute, out var parsedOrigin) ||
        parsedOrigin.Scheme != Uri.UriSchemeHttps || !string.IsNullOrEmpty(parsedOrigin.UserInfo) ||
        parsedOrigin.AbsolutePath != "/" || !string.IsNullOrEmpty(parsedOrigin.Query) || !string.IsNullOrEmpty(parsedOrigin.Fragment))
    {
        throw new InvalidOperationException("ApiStudio:PublicOrigin precisa ser uma origem HTTPS, por exemplo https://apicliente.example.com.");
    }
    var accessPasswordCodePointCount = 0;
    foreach (var _ in accessPassword.EnumerateRunes()) accessPasswordCodePointCount++;
    // Match the browser's Array.from(password).length validation for the 12-character minimum.
    if (accessPasswordCodePointCount < 12 || accessPassword.Length > 256)
    {
        throw new InvalidOperationException("ApiStudio:AccessPassword precisa ter entre 12 e 256 caracteres.");
    }
    publicOrigin = parsedOrigin.GetLeftPart(UriPartial.Authority).TrimEnd('/');
    builder.Configuration["ApiStudio:PublicOrigin"] = publicOrigin;
}
var configuredPort = hostedMode ? builder.Configuration.GetValue<int?>("PORT") ?? 10000 : builder.Configuration.GetValue("ApiStudio:Port", 51873);
var port = configuredPort;
if (port is < 1 or > 65535)
{
    throw new InvalidOperationException(hostedMode ? "PORT deve estar entre 1 e 65535." : "ApiStudio:Port deve estar entre 1 e 65535.");
}
var pkceFlowTimeoutSeconds = builder.Configuration.GetValue("ApiStudio:OAuthPkceFlowTimeoutSeconds", 300);
if (pkceFlowTimeoutSeconds is < 1 or > 600)
{
    throw new InvalidOperationException("ApiStudio:OAuthPkceFlowTimeoutSeconds deve estar entre 1 e 600.");
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
    if (hostedMode) options.ListenAnyIP(port);
    else options.Listen(IPAddress.Loopback, port);
});

using var httpClient = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false })
{
    Timeout = TimeSpan.FromSeconds(30),
    MaxResponseContentBufferSize = 5 * 1024 * 1024
};

builder.Services.AddDataProtection().SetApplicationName("ApiPublicacaoTester");
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.Name = "__Host-Vortix.Auth";
        options.Cookie.Path = "/";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.SecurePolicy = hostedMode ? CookieSecurePolicy.Always : CookieSecurePolicy.SameAsRequest;
        options.ExpireTimeSpan = TimeSpan.FromHours(12);
        options.SlidingExpiration = true;
        options.Events.OnRedirectToLogin = context =>
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return Task.CompletedTask;
        };
    });
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("hosted-login", context => RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 5,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
            AutoReplenishment = true
        }));
});
var app = builder.Build();
var dataProtector = app.Services.GetRequiredService<IDataProtectionProvider>().CreateProtector("LocalDataStore.v1");
var localDataStore = new LocalDataStore(databasePath, dataProtector, hostedMode ? maxWorkspaceBackupBytes : null);
var cookieJarLocks = new ConcurrentDictionary<string, SemaphoreSlim>(StringComparer.Ordinal);
var oauthPkceFlows = new ConcurrentDictionary<string, OAuthPkceFlow>(StringComparer.Ordinal);
await localDataStore.InitializeAsync();
app.Use(async (context, next) =>
{
    context.Response.Headers["Cache-Control"] = "no-store";
    context.Response.Headers["Referrer-Policy"] = "no-referrer";
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["Content-Security-Policy"] = "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
    await next();
});
app.UseRouting();
app.UseAuthentication();
app.UseRateLimiter();
app.Use(async (context, next) =>
{
    if (hostedMode && context.Request.Path.StartsWithSegments("/api") &&
        context.Request.Path != "/api/runtime" && context.Request.Path != "/api/auth/login" &&
        context.User.Identity?.IsAuthenticated != true)
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        return;
    }
    await next();
});
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapGet("/health", () => Results.Json(new { status = "ok", app = "ApiPublicacaoTester", product = "VortixApiClient", hostingMode }));
app.MapGet("/api/runtime", () => Results.Json(new { hostingMode, product = "VortixApiClient" }));
app.MapPost("/api/auth/login", async (HttpContext context, JsonElement request) =>
{
    if (!hostedMode) return Results.NotFound();
    if (!IsTrustedHostedOriginRequest(context, publicOrigin)) return Results.StatusCode(StatusCodes.Status403Forbidden);
    var suppliedPassword = request.ValueKind == JsonValueKind.Object && request.TryGetProperty("password", out var passwordElement) && passwordElement.ValueKind == JsonValueKind.String
        ? passwordElement.GetString() ?? string.Empty
        : string.Empty;
    var expectedHash = SHA256.HashData(Encoding.UTF8.GetBytes(accessPassword));
    var suppliedHash = SHA256.HashData(Encoding.UTF8.GetBytes(suppliedPassword));
    if (!CryptographicOperations.FixedTimeEquals(expectedHash, suppliedHash))
    {
        await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        return Results.StatusCode(StatusCodes.Status401Unauthorized);
    }
    var identity = new ClaimsIdentity([new Claim(ClaimTypes.Name, "vortix-user")], CookieAuthenticationDefaults.AuthenticationScheme);
    await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(identity), new AuthenticationProperties { IsPersistent = false, AllowRefresh = true });
    return Results.NoContent();
}).RequireRateLimiting("hosted-login");
app.MapPost("/api/auth/logout", async (HttpContext context) =>
{
    if (!hostedMode) return Results.NotFound();
    if (!IsTrustedHostedOriginRequest(context, publicOrigin) || context.User.Identity?.IsAuthenticated != true)
        return Results.StatusCode(StatusCodes.Status403Forbidden);
    await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
    return Results.NoContent();
});
app.MapPost("/api/oauth/pkce/redirect-uri", (HttpContext context, OAuthPkceRedirectPreviewRequest request) =>
{
    if (!IsTrustedLocalRequest(context, port)) return Results.StatusCode(StatusCodes.Status403Forbidden);
    if (!TryParseOAuthEndpoint(request.AuthorizationUrl, out var endpoint, out var endpointError))
        return Error(StatusCodes.Status400BadRequest, endpointError);
    if (ContainsOAuthAuthorizationParameter(endpoint) || ContainsOAuthCredentialParameter(endpoint))
        return Error(StatusCodes.Status400BadRequest, "Remova parâmetros OAuth ou credenciais da URL de autorização.");
    return Results.Json(new { redirectUri = BuildOAuthRedirectUri(publicOrigin, port, CreateOAuthProviderKey(endpoint)) });
});
app.MapPost("/api/oauth/pkce/start", async (HttpContext context, OAuthPkceStartRequest request, CancellationToken cancellationToken) =>
{
    if (!IsTrustedLocalRequest(context, port)) return Results.StatusCode(StatusCodes.Status403Forbidden);
    if (!TryParseOAuthEndpoint(request.AuthorizationUrl, out var authorizationEndpoint, out var endpointError))
        return Error(StatusCodes.Status400BadRequest, endpointError);
    if (!TryParseOAuthEndpoint(request.TokenUrl, out var tokenEndpoint, out endpointError))
        return Error(StatusCodes.Status400BadRequest, endpointError);
    var clientId = request.ClientId?.Trim() ?? string.Empty;
    var scope = string.Join(' ', (request.Scope ?? string.Empty).Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
    if (clientId.Length is 0 or > 512 || clientId.Contains('\r') || clientId.Contains('\n'))
        return Error(StatusCodes.Status400BadRequest, "Informe um client_id válido.");
    if (scope.Length > 4096 || scope.Contains('\r') || scope.Contains('\n'))
        return Error(StatusCodes.Status400BadRequest, "O scope OAuth é inválido ou excede o limite.");
    if (ContainsOAuthAuthorizationParameter(authorizationEndpoint) || ContainsOAuthCredentialParameter(authorizationEndpoint))
        return Error(StatusCodes.Status400BadRequest, "Remova parâmetros OAuth duplicados da URL de autorização.");
    if (ContainsOAuthCredentialParameter(tokenEndpoint))
        return Error(StatusCodes.Status400BadRequest, "A URL do token endpoint não pode conter credenciais ou tokens.");

    var now = DateTimeOffset.UtcNow;
    foreach (var item in oauthPkceFlows)
        if (item.Value.ExpiresAtUtc <= now) oauthPkceFlows.TryRemove(item.Key, out _);
    if (oauthPkceFlows.Count >= 16)
        return Error(StatusCodes.Status429TooManyRequests, "Já existem fluxos OAuth pendentes. Cancele um ou aguarde a expiração.");

    var state = CreateOAuthRandomValue();
    var verifier = CreateOAuthRandomValue();
    var challenge = CreateOAuthCodeChallenge(verifier);
    var providerKey = CreateOAuthProviderKey(authorizationEndpoint);
    var redirectUri = BuildOAuthRedirectUri(publicOrigin, port, providerKey);
    var authorizationUrl = await BuildOAuthAuthorizationUrlAsync(authorizationEndpoint, clientId, scope, redirectUri, state, challenge, cancellationToken);
    var flow = new OAuthPkceFlow
    {
        State = state,
        CodeVerifier = verifier,
        ClientId = clientId,
        ProviderKey = providerKey,
        TokenEndpoint = tokenEndpoint,
        RedirectUri = redirectUri,
        ExpiresAtUtc = now.AddSeconds(pkceFlowTimeoutSeconds)
    };
    if (!oauthPkceFlows.TryAdd(state, flow))
        return Error(StatusCodes.Status500InternalServerError, "Não foi possível iniciar o fluxo OAuth.");

    return Results.Json(new { state, redirectUri, authorizationUrl, expiresAt = flow.ExpiresAtUtc });
});
app.MapGet("/oauth/callback/{providerKey}", async (HttpContext context, string providerKey, CancellationToken cancellationToken) =>
{
    if (!IsTrustedOAuthCallback(context, port)) return Results.StatusCode(StatusCodes.Status403Forbidden);
    var states = context.Request.Query["state"];
    if (states.Count != 1 || string.IsNullOrWhiteSpace(states[0]) || states[0]!.Length > 128)
        return Results.Redirect("/oauth/pkce/invalid");
    if (!oauthPkceFlows.TryGetValue(states[0]!, out var flow) ||
        !string.Equals(flow.ProviderKey, providerKey, StringComparison.Ordinal))
        return Results.Redirect("/oauth/pkce/invalid");

    var errors = context.Request.Query["error"];
    var codes = context.Request.Query["code"];
    if (errors.Count > 1 || codes.Count > 1 || (errors.Count > 0 && codes.Count > 0))
        return Results.Redirect("/oauth/pkce/invalid");

    string code = string.Empty;
    string verifier = string.Empty;
    lock (flow.SyncRoot)
    {
        if (flow.ExpiresAtUtc <= DateTimeOffset.UtcNow)
        {
            flow.Status = "expired";
            flow.ClearSecrets();
            return Results.Redirect("/oauth/pkce/complete");
        }
        if (flow.Status != "pending") return Results.Redirect("/oauth/pkce/invalid");
        if (errors.Count == 1)
        {
            flow.Status = string.Equals(errors[0], "access_denied", StringComparison.Ordinal) ? "cancelled" : "error";
            flow.ErrorMessage = flow.Status == "cancelled" ? "Autorização cancelada." : "O servidor de autorização retornou um erro.";
            flow.CodeVerifier = string.Empty;
            return Results.Redirect("/oauth/pkce/complete");
        }
        if (codes.Count != 1 || string.IsNullOrWhiteSpace(codes[0]) || codes[0]!.Length > 4096 ||
            codes[0]!.Contains('\r') || codes[0]!.Contains('\n'))
            return Results.Redirect("/oauth/pkce/invalid");
        flow.Status = "exchanging";
        code = codes[0]!;
        verifier = flow.CodeVerifier;
    }

    try
    {
        using var content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"] = "authorization_code",
            ["code"] = code,
            ["redirect_uri"] = flow.RedirectUri,
            ["client_id"] = flow.ClientId,
            ["code_verifier"] = verifier
        });
        using var tokenRequest = new HttpRequestMessage(HttpMethod.Post, flow.TokenEndpoint) { Content = content };
        tokenRequest.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        using var tokenResponse = await httpClient.SendAsync(tokenRequest, HttpCompletionOption.ResponseContentRead, cancellationToken);
        var tokenBody = await tokenResponse.Content.ReadAsStringAsync(cancellationToken);
        if (!tokenResponse.IsSuccessStatusCode)
        {
            SetOAuthPkceFlowError(flow, $"O token endpoint respondeu HTTP {(int)tokenResponse.StatusCode}.");
            return Results.Redirect("/oauth/pkce/complete");
        }
        if (!TryParseOAuthPkceTokenResponse(tokenBody, out var accessToken, out var refreshToken, out var expiresIn))
        {
            SetOAuthPkceFlowError(flow, "A resposta do token endpoint não contém um access_token Bearer válido.");
            return Results.Redirect("/oauth/pkce/complete");
        }
        lock (flow.SyncRoot)
        {
            if (flow.ExpiresAtUtc <= DateTimeOffset.UtcNow)
            {
                flow.Status = "expired";
                flow.ClearSecrets();
                return Results.Redirect("/oauth/pkce/complete");
            }
            flow.AccessToken = accessToken;
            flow.RefreshToken = refreshToken;
            flow.ExpiresIn = expiresIn;
            flow.ObtainedAtUtc = DateTimeOffset.UtcNow;
            flow.CodeVerifier = string.Empty;
            flow.Status = "complete";
        }
        return Results.Redirect("/oauth/pkce/complete");
    }
    catch (OperationCanceledException) when (!context.RequestAborted.IsCancellationRequested)
    {
        SetOAuthPkceFlowError(flow, "Tempo limite ao trocar o código por um token.");
        return Results.Redirect("/oauth/pkce/complete");
    }
    catch (HttpRequestException)
    {
        SetOAuthPkceFlowError(flow, "Falha de rede ou TLS no token endpoint.");
        return Results.Redirect("/oauth/pkce/complete");
    }
    catch (JsonException)
    {
        SetOAuthPkceFlowError(flow, "A resposta do token endpoint não contém JSON válido.");
        return Results.Redirect("/oauth/pkce/complete");
    }
});

app.MapGet("/oauth/pkce/complete", (HttpContext context) =>
{
    if (!IsTrustedOAuthCallback(context, port)) return Results.StatusCode(StatusCodes.Status403Forbidden);
    return OAuthPkceCallbackPage();
});
app.MapGet("/oauth/pkce/invalid", (HttpContext context) =>
{
    if (!IsTrustedOAuthCallback(context, port)) return Results.StatusCode(StatusCodes.Status403Forbidden);
    return OAuthPkceInvalidCallbackPage();
});
app.MapGet("/api/oauth/pkce/status/{state}", (HttpContext context, string state) =>
{
    if (!IsTrustedLocalRequest(context, port)) return Results.StatusCode(StatusCodes.Status403Forbidden);
    if (state.Length is < 43 or > 128 || !oauthPkceFlows.TryGetValue(state, out var flow))
        return Results.NotFound();
    lock (flow.SyncRoot)
    {
        if (flow.ExpiresAtUtc <= DateTimeOffset.UtcNow && flow.Status is "pending" or "exchanging" or "complete")
        {
            flow.Status = "expired";
            flow.ClearSecrets();
        }
        return flow.Status == "complete"
            ? Results.Json(new { status = flow.Status, accessToken = flow.AccessToken, refreshToken = flow.RefreshToken, expiresIn = flow.ExpiresIn, obtainedAt = flow.ObtainedAtUtc })
            : Results.Json(new { status = flow.Status, error = flow.ErrorMessage });
    }
});

app.MapDelete("/api/oauth/pkce/status/{state}", (HttpContext context, string state) =>
{
    if (!IsTrustedLocalRequest(context, port)) return Results.StatusCode(StatusCodes.Status403Forbidden);
    if (!oauthPkceFlows.TryRemove(state, out var flow)) return Results.NotFound();
    lock (flow.SyncRoot) flow.ClearSecrets();
    return Results.NoContent();
});
app.MapGet("/api/storage/{store}", async (HttpContext context, string store, string? key, CancellationToken cancellationToken) =>
{
    if (!IsTrustedLocalRequest(context, port)) return Results.StatusCode(StatusCodes.Status403Forbidden);
    try
    {
        if (key is null)
        {
            var records = await localDataStore.ReadAllAsync(store, cancellationToken);
            if (localDataStore.ConsumeTokenCredentialModeRecoveryWarning()) context.Response.Headers["X-Api-Studio-Data-Recovery"] = "tokenCredentialMode";
            return Results.Json(records);
        }

        var value = await localDataStore.ReadAsync(store, key, cancellationToken);
        if (localDataStore.ConsumeTokenCredentialModeRecoveryWarning()) context.Response.Headers["X-Api-Studio-Data-Recovery"] = "tokenCredentialMode";
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
    var workspace = await localDataStore.ReadWorkspaceAsync(cancellationToken);
    if (localDataStore.ConsumeTokenCredentialModeRecoveryWarning()) context.Response.Headers["X-Api-Studio-Data-Recovery"] = "tokenCredentialMode";
    return Results.Json(workspace);
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
    catch (WorkspaceSnapshotLimitExceededException exception)
    {
        return Results.Json(new { error = exception.Message }, statusCode: StatusCodes.Status413PayloadTooLarge);
    }
    catch (ArgumentException)
    {
        return Results.Json(new { error = "Backup inválido ou incompatível." }, statusCode: StatusCodes.Status400BadRequest);
    }
});app.MapPost("/api/storage/history/trim", async (HttpContext context, JsonElement value, CancellationToken cancellationToken) =>
{
    if (!IsTrustedLocalRequest(context, port)) return Results.StatusCode(StatusCodes.Status403Forbidden);
    if (value.ValueKind != JsonValueKind.Object ||
        !value.TryGetProperty("limit", out var limitElement) ||
        limitElement.ValueKind != JsonValueKind.Number || !limitElement.TryGetInt32(out var limit) || limit is < 1 or > 5000)
    {
        return Results.Json(new { error = "O limite do histórico deve estar entre 1 e 5000." }, statusCode: StatusCodes.Status400BadRequest);
    }
    var removed = await localDataStore.RetainHistoryAsync(limit, cancellationToken);
    return Results.Json(new { limit, removed });
});

app.MapPost("/api/storage/{store}", async (HttpContext context, string store, JsonElement value, int? retentionLimit, CancellationToken cancellationToken) =>
{
    if (!IsTrustedLocalRequest(context, port)) return Results.StatusCode(StatusCodes.Status403Forbidden);
    try
    {
        if (store == "history" && retentionLimit.HasValue)
        {
            if (retentionLimit.Value is < 1 or > 5000)
                return Results.Json(new { error = "O limite do histórico deve estar entre 1 e 5000." }, statusCode: StatusCodes.Status400BadRequest);
            var removed = await localDataStore.WriteHistoryAsync(value, retentionLimit.Value, cancellationToken);
            return Results.Json(new { removed });
        }
        await localDataStore.WriteAsync(store, value, cancellationToken);
        return Results.NoContent();
    }
    catch (WorkspaceSnapshotLimitExceededException exception)
    {
        return Results.Json(new { error = exception.Message }, statusCode: StatusCodes.Status413PayloadTooLarge);
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
    catch (WorkspaceSnapshotLimitExceededException exception)
    {
        return Results.Json(new { error = exception.Message }, statusCode: StatusCodes.Status413PayloadTooLarge);
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
app.MapPost("/api/graphql/introspection", async (HttpContext context, ApiCall request) =>
{
    if (!IsTrustedLocalRequest(context, port)) return Results.StatusCode(StatusCodes.Status403Forbidden);
    if (request is null || string.IsNullOrWhiteSpace(request.BaseUrl) || string.IsNullOrWhiteSpace(request.Route))
        return Error(StatusCodes.Status400BadRequest, "Informe o endpoint GraphQL antes de consultar o schema.");

    // This endpoint always sends the fixed read-only introspection query; client-supplied methods and bodies are ignored.
    var introspectionCall = new ApiCall
    {
        BaseUrl = request.BaseUrl,
        Route = request.Route,
        Method = "POST",
        Headers = request.Headers,
        AuthType = request.AuthType,
        BearerToken = request.BearerToken,
        BasicUsername = request.BasicUsername,
        BasicPassword = request.BasicPassword,
        ApiKeyName = request.ApiKeyName,
        ApiKeyLocation = request.ApiKeyLocation,
        ApiKeyValue = request.ApiKeyValue,
        EnvironmentId = request.EnvironmentId,
        BodyMode = "graphql",
        Body = graphqlIntrospectionBody,
        ConfirmTestData = true,
        TestDataPhrase = "TESTE",
        AllowInsecureHttp = request.AllowInsecureHttp
    };
    return await HandleRequest(context, introspectionCall, httpClient, localDataStore, cookieJarLocks, port);
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
        (call.TokenClientId?.Length ?? 0) > 512 || (call.TokenClientSecret?.Length ?? 0) > 8192 || (call.TokenFlow?.Length ?? 0) > 64 || (call.AuthType?.Length ?? 0) > 16 || (call.BasicUsername?.Length ?? 0) > 1024 || (call.BasicPassword?.Length ?? 0) > 8192 || (call.ApiKeyName?.Length ?? 0) > 128 || (call.ApiKeyLocation?.Length ?? 0) > 16 || (call.ApiKeyValue?.Length ?? 0) > 8192 || (call.BodyMode?.Length ?? 0) > 16 || (call.EnvironmentId?.Length ?? 0) > 128 || call.EnvironmentId?.Contains('\r') == true || call.EnvironmentId?.Contains('\n') == true)
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
    var tokenFlow = call.TokenFlow?.Trim() ?? string.Empty;
    var isOAuth2ClientCredentials = string.Equals(tokenFlow, "oauth2-client-credentials", StringComparison.Ordinal);
    if (tokenFlow.Length > 0 && !isOAuth2ClientCredentials) return Error(StatusCodes.Status400BadRequest, "Fluxo de token não suportado.");
    if (isOAuth2ClientCredentials && !isTokenRequest) return Error(StatusCodes.Status400BadRequest, "Confirme o fluxo OAuth antes de solicitar credenciais.");

    if (isTokenRequest)
    {
        if (isOAuth2ClientCredentials)
        {
            if (method != "POST" || bodyMode != "urlencoded" || string.IsNullOrWhiteSpace(body) || authType is not ("none" or "basic"))
                return Error(StatusCodes.Status400BadRequest, "OAuth Client Credentials exige POST application/x-www-form-urlencoded.");
            if (contentTypeHeader is not null)
            {
                var declaredContentType = contentTypeHeader[(contentTypeHeader.IndexOf(':') + 1)..].Trim();
                if (!MediaTypeHeaderValue.TryParse(declaredContentType, out var tokenContentType) ||
                    !string.Equals(tokenContentType.MediaType, "application/x-www-form-urlencoded", StringComparison.OrdinalIgnoreCase))
                    return Error(StatusCodes.Status400BadRequest, "OAuth Client Credentials exige Content-Type application/x-www-form-urlencoded.");
            }
            if (!TryGetFormField(body, "grant_type", out var grantType) || grantType != "client_credentials")
                return Error(StatusCodes.Status400BadRequest, "O formulário OAuth precisa conter grant_type=client_credentials.");
            var hasFormClientId = TryGetFormField(body, "client_id", out var formClientId);
            var hasFormClientSecret = TryGetFormField(body, "client_secret", out var formClientSecret);
            if (authType == "basic")
            {
                if (ContainsFormField(body, "client_id") || ContainsFormField(body, "client_secret"))
                    return Error(StatusCodes.Status400BadRequest, "Use somente um método de autenticação do cliente OAuth.");
            }
            else if (!hasFormClientId || string.IsNullOrWhiteSpace(formClientId) || !hasFormClientSecret || string.IsNullOrEmpty(formClientSecret))
            {
                return Error(StatusCodes.Status400BadRequest, "OAuth client_secret_post exige client_id e client_secret no formulário.");
            }
        }
        else
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
    if (isTokenRequest && !isOAuth2ClientCredentials && call.TokenCredentialMode == "query")
    {
        var separator = targetText.Contains('?') ? "&" : "?";
        targetText += separator + Uri.EscapeDataString(call.TokenClientIdField) + "=" + Uri.EscapeDataString(tokenClientId.Trim()) +
            "&" + Uri.EscapeDataString(call.TokenClientSecretField) + "=" + Uri.EscapeDataString(tokenClientSecret);
    }
    if (!Uri.TryCreate(targetText, UriKind.Absolute, out var targetUri))
    {
        return Error(StatusCodes.Status400BadRequest, "URL final inválida.");
    }

    if (isOAuth2ClientCredentials &&
        (ContainsQueryParameter(targetUri, "client_id") || ContainsQueryParameter(targetUri, "client_secret")))
    {
        return Error(StatusCodes.Status400BadRequest, "Credenciais OAuth nunca podem ser enviadas na URL.");
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
    if (isTokenRequest && !isOAuth2ClientCredentials && call.TokenCredentialMode == "body")
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
    var configuration = context.RequestServices.GetRequiredService<IConfiguration>();
    if (string.Equals(configuration["ApiStudio:HostingMode"], "render", StringComparison.OrdinalIgnoreCase))
    {
        var publicOrigin = configuration["ApiStudio:PublicOrigin"];
        if (!Uri.TryCreate(publicOrigin, UriKind.Absolute, out var parsedOrigin)) return false;
        var hostedRequestOrigin = context.Request.Headers["Origin"].ToString();
        var hostedSafeReadWithoutOrigin = hostedRequestOrigin.Length == 0 && HttpMethods.IsGet(context.Request.Method);
        return context.User.Identity?.IsAuthenticated == true &&
            string.Equals(context.Request.Headers["X-Api-Studio"].ToString(), "1", StringComparison.Ordinal) &&
            (string.Equals(hostedRequestOrigin, publicOrigin, StringComparison.OrdinalIgnoreCase) || hostedSafeReadWithoutOrigin) &&
            string.Equals(context.Request.Host.Value, parsedOrigin.Authority, StringComparison.OrdinalIgnoreCase);
    }
    var origin = context.Request.Headers["Origin"].ToString();
    var sameOrigin = string.Equals(origin, $"http://127.0.0.1:{port}", StringComparison.OrdinalIgnoreCase);
    // Browsers omit Origin on same-origin GET fetches; keep writes and proxy calls origin-checked.
    var safeReadWithoutOrigin = origin.Length == 0 && HttpMethods.IsGet(context.Request.Method);
    return string.Equals(context.Request.Headers["X-Api-Studio"].ToString(), "1", StringComparison.Ordinal) &&
        (sameOrigin || safeReadWithoutOrigin) &&
        string.Equals(context.Request.Host.Value, $"127.0.0.1:{port}", StringComparison.OrdinalIgnoreCase);
}

static bool IsTrustedHostedOriginRequest(HttpContext context, string publicOrigin)
{
    if (!Uri.TryCreate(publicOrigin, UriKind.Absolute, out var parsedOrigin)) return false;
    return string.Equals(context.Request.Headers["X-Api-Studio"].ToString(), "1", StringComparison.Ordinal) &&
        string.Equals(context.Request.Headers["Origin"].ToString(), publicOrigin, StringComparison.OrdinalIgnoreCase) &&
        string.Equals(context.Request.Host.Value, parsedOrigin.Authority, StringComparison.OrdinalIgnoreCase);
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

static bool ContainsFormField(string form, string fieldName)
{
    foreach (var pair in form.Split('&', StringSplitOptions.RemoveEmptyEntries))
    {
        var separator = pair.IndexOf('=');
        var rawName = separator < 0 ? pair : pair[..separator];
        try
        {
            var name = Uri.UnescapeDataString(rawName.Replace('+', ' '));
            if (string.Equals(name, fieldName, StringComparison.Ordinal)) return true;
        }
        catch (UriFormatException)
        {
            return false;
        }
    }
    return false;
}
static bool TryGetFormField(string form, string fieldName, out string value)
{
    value = string.Empty;
    var found = false;
    foreach (var pair in form.Split('&', StringSplitOptions.RemoveEmptyEntries))
    {
        var separator = pair.IndexOf('=');
        var rawName = separator < 0 ? pair : pair[..separator];
        string name;
        string candidate;
        try
        {
            name = Uri.UnescapeDataString(rawName.Replace('+', ' '));
            candidate = Uri.UnescapeDataString((separator < 0 ? string.Empty : pair[(separator + 1)..]).Replace('+', ' '));
        }
        catch (UriFormatException)
        {
            return false;
        }
        if (!string.Equals(name, fieldName, StringComparison.Ordinal)) continue;
        if (found) return false;
        value = candidate;
        found = true;
    }
    return found;
}
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

static bool TryParseOAuthEndpoint(string? value, out Uri endpoint, out string error)
{
    endpoint = null!;
    error = "Informe uma URL absoluta HTTP ou HTTPS para o endpoint OAuth.";
    var text = value?.Trim() ?? string.Empty;
    if (text.Length is 0 or > 2048 || !Uri.TryCreate(text, UriKind.Absolute, out var parsed) ||
        parsed.Scheme is not ("http" or "https") || parsed.UserInfo.Length > 0 || parsed.Fragment.Length > 0)
        return false;
    if (parsed.Scheme == Uri.UriSchemeHttp && !IsLoopbackHost(parsed.Host))
    {
        error = "Endpoints OAuth remotos exigem HTTPS.";
        return false;
    }
    endpoint = parsed;
    return true;
}

static bool ContainsOAuthAuthorizationParameter(Uri uri) =>
    new[] { "response_type", "client_id", "redirect_uri", "state", "scope", "code_challenge", "code_challenge_method" }
        .Any(name => ContainsQueryParameter(uri, name));

static bool ContainsOAuthCredentialParameter(Uri uri)
{
    foreach (var pair in uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
    {
        var separator = pair.IndexOf('=');
        var rawName = separator < 0 ? pair : pair[..separator];
        string name;
        try { name = Uri.UnescapeDataString(rawName.Replace('+', ' ')); }
        catch (UriFormatException) { return true; }
        if (System.Text.RegularExpressions.Regex.IsMatch(name, "authorization|auth|bearer|token|secret|password|credential|api[-_]?key|client_id|code|verifier", System.Text.RegularExpressions.RegexOptions.IgnoreCase | System.Text.RegularExpressions.RegexOptions.CultureInvariant))
            return true;
    }
    return false;
}

static string CreateOAuthRandomValue() =>
    Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

static string CreateOAuthCodeChallenge(string verifier) =>
    Convert.ToBase64String(SHA256.HashData(Encoding.ASCII.GetBytes(verifier))).TrimEnd('=').Replace('+', '-').Replace('/', '_');

static async Task<string> BuildOAuthAuthorizationUrlAsync(
    Uri endpoint,
    string clientId,
    string scope,
    string redirectUri,
    string state,
    string challenge,
    CancellationToken cancellationToken)
{
    var parameters = new List<KeyValuePair<string, string>>
    {
        new("response_type", "code"),
        new("client_id", clientId),
        new("redirect_uri", redirectUri),
        new("state", state),
        new("code_challenge", challenge),
        new("code_challenge_method", "S256")
    };
    if (scope.Length > 0) parameters.Add(new("scope", scope));
    using var content = new FormUrlEncodedContent(parameters);
    var query = await content.ReadAsStringAsync(cancellationToken);
    var builder = new UriBuilder(endpoint);
    var existingQuery = builder.Query.TrimStart('?');
    builder.Query = existingQuery.Length == 0 ? query : existingQuery + "&" + query;
    return builder.Uri.AbsoluteUri;
}

static bool IsTrustedOAuthCallback(HttpContext context, int port)
{
    var configuration = context.RequestServices.GetRequiredService<IConfiguration>();
    if (string.Equals(configuration["ApiStudio:HostingMode"], "render", StringComparison.OrdinalIgnoreCase))
    {
        var publicOrigin = configuration["ApiStudio:PublicOrigin"];
        return context.User.Identity?.IsAuthenticated == true &&
            Uri.TryCreate(publicOrigin, UriKind.Absolute, out var parsedOrigin) &&
            string.Equals(context.Request.Host.Value, parsedOrigin.Authority, StringComparison.OrdinalIgnoreCase);
    }
    var remoteAddress = context.Connection.RemoteIpAddress;
    return remoteAddress is not null && IPAddress.IsLoopback(remoteAddress) &&
        string.Equals(context.Request.Host.Host, "127.0.0.1", StringComparison.OrdinalIgnoreCase) &&
        context.Request.Host.Port == port;
}

static string BuildOAuthRedirectUri(string publicOrigin, int port, string providerKey) =>
    string.IsNullOrWhiteSpace(publicOrigin)
        ? $"http://127.0.0.1:{port}/oauth/callback/{providerKey}"
        : $"{publicOrigin}/oauth/callback/{providerKey}";

static string CreateOAuthProviderKey(Uri endpoint)
{
    var digest = SHA256.HashData(Encoding.UTF8.GetBytes(endpoint.AbsoluteUri));
    return Convert.ToBase64String(digest[..16]).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}

static IResult OAuthPkceCallbackPage() =>
    Results.Content("<!doctype html><html lang=\"pt-BR\"><meta charset=\"utf-8\"><meta name=\"referrer\" content=\"no-referrer\"><title>Vortix · OAuth</title><body><main><h1>Fluxo OAuth encerrado</h1><p>Volte ao Vortix para conferir o resultado. Esta aba pode ser fechada.</p></main></body></html>", "text/html; charset=utf-8", Encoding.UTF8);

static IResult OAuthPkceInvalidCallbackPage() =>
    Results.Content("<!doctype html><html lang=\"pt-BR\"><meta charset=\"utf-8\"><meta name=\"referrer\" content=\"no-referrer\"><title>Vortix · OAuth</title><body><main><h1>Callback rejeitado</h1><p>Confira a redirect URI cadastrada e tente uma nova autorização.</p></main></body></html>", "text/html; charset=utf-8", Encoding.UTF8);

static void SetOAuthPkceFlowError(OAuthPkceFlow flow, string message)
{
    lock (flow.SyncRoot)
    {
        flow.Status = "error";
        flow.ErrorMessage = message;
        flow.CodeVerifier = string.Empty;
        flow.AccessToken = string.Empty;
        flow.RefreshToken = string.Empty;
    }
}

static bool TryParseOAuthPkceTokenResponse(
    string body,
    out string accessToken,
    out string refreshToken,
    out long? expiresIn)
{
    accessToken = string.Empty;
    refreshToken = string.Empty;
    expiresIn = null;
    using var document = JsonDocument.Parse(body);
    var root = document.RootElement;
    if (root.ValueKind != JsonValueKind.Object ||
        !root.TryGetProperty("access_token", out var accessTokenValue) ||
        accessTokenValue.ValueKind != JsonValueKind.String)
        return false;
    accessToken = accessTokenValue.GetString()?.Trim() ?? string.Empty;
    if (accessToken.Length is 0 or > 8192 || accessToken.Contains('\r') || accessToken.Contains('\n'))
        return false;
    if (!root.TryGetProperty("token_type", out var tokenTypeValue) ||
        tokenTypeValue.ValueKind != JsonValueKind.String ||
        !string.Equals(tokenTypeValue.GetString(), "Bearer", StringComparison.OrdinalIgnoreCase))
        return false;
    if (root.TryGetProperty("refresh_token", out var refreshTokenValue))
    {
        if (refreshTokenValue.ValueKind != JsonValueKind.String) return false;
        refreshToken = refreshTokenValue.GetString() ?? string.Empty;
        if (refreshToken.Length > 8192 || refreshToken.Contains('\r') || refreshToken.Contains('\n')) return false;
    }
    if (root.TryGetProperty("expires_in", out var expiresValue))
    {
        if (expiresValue.ValueKind != JsonValueKind.Number || !expiresValue.TryGetInt64(out var seconds) ||
            seconds <= 0 || seconds > 3153600000)
            return false;
        expiresIn = seconds;
    }
    return true;
}
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
    /// <value>One of <c>json</c>, <c>text</c>, <c>xml</c>, <c>urlencoded</c>, <c>multipart</c>, or <c>graphql</c>; empty preserves JSON defaults.</value>
    public string BodyMode { get; init; } = "json";
    public string Body { get; init; } = string.Empty;
    public List<MultipartField>? MultipartFields { get; init; } = [];
    public bool ConfirmTestData { get; init; }
    public string TestDataPhrase { get; init; } = string.Empty;
    public bool ConfirmTokenRequest { get; init; }
    public string TokenClientId { get; init; } = string.Empty;
    public string TokenClientSecret { get; init; } = string.Empty;
    /// <summary>Gets or sets the guarded OAuth token grant flow.</summary>
    /// <value><c>oauth2-client-credentials</c> for the standard Client Credentials grant; otherwise empty.</value>
    public string TokenFlow { get; init; } = string.Empty;
    public string TokenCredentialMode { get; init; } = "body";
    public string TokenClientIdField { get; init; } = "client_id";
    public string TokenClientSecretField { get; init; } = "client_secret";
    public bool AllowInsecureHttp { get; init; }
}

internal sealed record OAuthPkceRedirectPreviewRequest
{
    /// <summary>Gets or sets the OAuth authorization endpoint used to preview its registered loopback redirect URI.</summary>
    public string AuthorizationUrl { get; init; } = string.Empty;
}
internal sealed record OAuthPkceStartRequest
{
    /// <summary>Gets or sets the OAuth authorization endpoint.</summary>
    public string AuthorizationUrl { get; init; } = string.Empty;

    /// <summary>Gets or sets the OAuth token endpoint.</summary>
    public string TokenUrl { get; init; } = string.Empty;

    /// <summary>Gets or sets the registered public client identifier.</summary>
    public string ClientId { get; init; } = string.Empty;

    /// <summary>Gets or sets the optional space-delimited OAuth scopes.</summary>
    public string Scope { get; init; } = string.Empty;
}

internal sealed class OAuthPkceFlow
{
    /// <summary>Gets the synchronization lock for this transient flow.</summary>
    public object SyncRoot { get; } = new();

    /// <summary>Gets or sets the one-time anti-forgery state value.</summary>
    public string State { get; init; } = string.Empty;

    /// <summary>Gets or sets the one-time PKCE verifier retained only in memory.</summary>
    public string CodeVerifier { get; set; } = string.Empty;

    /// <summary>Gets or sets the public OAuth client identifier.</summary>
    public string ClientId { get; init; } = string.Empty;

    /// <summary>Gets or sets the provider-specific callback path key.</summary>
    public string ProviderKey { get; init; } = string.Empty;

    /// <summary>Gets or sets the validated token endpoint.</summary>
    public Uri TokenEndpoint { get; init; } = new("http://127.0.0.1");

    /// <summary>Gets or sets the exact loopback redirect URI used by this flow.</summary>
    public string RedirectUri { get; init; } = string.Empty;

    /// <summary>Gets or sets the expiration time for this pending flow.</summary>
    public DateTimeOffset ExpiresAtUtc { get; init; }

    /// <summary>Gets or sets the flow state exposed to the local status endpoint.</summary>
    public string Status { get; set; } = "pending";

    /// <summary>Gets or sets a safe user-facing failure message.</summary>
    public string ErrorMessage { get; set; } = string.Empty;

    /// <summary>Gets or sets the access token held temporarily until the user chooses whether to save it.</summary>
    public string AccessToken { get; set; } = string.Empty;

    /// <summary>Gets or sets the optional refresh token held temporarily until the user chooses whether to save it.</summary>
    public string RefreshToken { get; set; } = string.Empty;

    /// <summary>Gets or sets the token lifetime in seconds when provided by the authorization server.</summary>
    public long? ExpiresIn { get; set; }

    /// <summary>Gets or sets the time when the authorization server returned the tokens.</summary>
    public DateTimeOffset? ObtainedAtUtc { get; set; }

    /// <summary>Clears token and verifier material retained by this flow.</summary>
    public void ClearSecrets()
    {
        CodeVerifier = string.Empty;
        AccessToken = string.Empty;
        RefreshToken = string.Empty;
    }
}
