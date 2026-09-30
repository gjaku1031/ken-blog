FROM node:24.21.0-bookworm-slim AS assets
WORKDIR /build
COPY package.json package-lock.json tsconfig.json ./
COPY scripts scripts
COPY src/main/resources/web src/main/resources/web
RUN npm ci && npm run build:assets

FROM eclipse-temurin:25-jdk AS build
WORKDIR /build
COPY gradlew build.gradle.kts settings.gradle.kts ./
COPY gradle gradle
COPY src src
COPY --from=assets /build/build/generated-resources build/generated-resources
RUN chmod +x gradlew && ./gradlew --no-daemon -PskipWeb=true bootJar

FROM eclipse-temurin:25-jre
WORKDIR /app
RUN groupadd --gid 1001 blogdata \
    && useradd --system --uid 10001 --gid blogdata --create-home appuser \
    && install -d -m 0750 -o appuser -g blogdata /var/lib/ken-blog/assets /app/content
COPY --from=build /build/build/libs/ken-blog-api.jar /app/app.jar
USER appuser
EXPOSE 8080 8082 8443
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=50", "-jar", "/app/app.jar"]
