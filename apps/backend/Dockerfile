FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY pom.xml .
RUN mvn -q dependency:go-offline
COPY src ./src
RUN mvn -q clean package -DskipTests

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /app/target/*.jar app.jar

# The platform (or docker-compose locally) injects PORT; application.yaml binds to it. Never
# hardcode the bind port, and never bind loopback-only — see poc-platform-sdk's POC-CONTRACT.md.
ENV PORT=8081
ENTRYPOINT ["java", "-jar", "app.jar"]
