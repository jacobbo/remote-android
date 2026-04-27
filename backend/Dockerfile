# Build stage
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY RemoteDesktop/*.csproj ./RemoteDesktop/
RUN dotnet restore RemoteDesktop/RemoteDesktop.csproj
COPY . .
RUN dotnet publish RemoteDesktop/RemoteDesktop.csproj -c Release -o /app/publish /p:UseAppHost=false

# Runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app/publish .
EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080
ENTRYPOINT ["dotnet", "RemoteDesktop.dll"]
