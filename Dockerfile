FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY VortixApiClient.csproj ./
RUN dotnet restore VortixApiClient.csproj
COPY . ./
RUN dotnet publish VortixApiClient.csproj --configuration Release --no-restore --output /out /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /out ./
RUN groupadd --system --gid 10001 vortix \
    && useradd --system --uid 10001 --gid vortix --home-dir /home/vortix --create-home vortix
ENV ASPNETCORE_ENVIRONMENT=Production \
    HOME=/home/vortix \
    ApiStudio__HostingMode=render \
    ApiStudio__DatabasePath=/tmp/vortix-api-client.sqlite
EXPOSE 10000
USER vortix
ENTRYPOINT ["dotnet", "VortixApiClient.dll"]
