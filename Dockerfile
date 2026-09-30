FROM node:24.21.0-bookworm-slim AS assets
WORKDIR /build
COPY package.json package-lock.json tsconfig.json ./
COPY scripts scripts
COPY src/main/frontend src/main/frontend
RUN npm ci && npm run build:frontend

FROM eclipse-temurin:25-jdk AS build
WORKDIR /build
COPY mvnw pom.xml ./
COPY .mvn .mvn
RUN chmod +x mvnw && ./mvnw -q -DskipTests dependency:go-offline
COPY src src
COPY --from=assets /build/target/generated-resources/static target/generated-resources/static
RUN ./mvnw -q -DskipTests -Dskip.frontend=true package

FROM eclipse-temurin:25-jre
WORKDIR /app
RUN useradd --system --uid 10001 --create-home appuser
COPY --from=build /build/target/ken-blog-api-0.0.1-SNAPSHOT.jar /app/app.jar
USER appuser
EXPOSE 8080 8082 8443
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=50", "-jar", "/app/app.jar"]
