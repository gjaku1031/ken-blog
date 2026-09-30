FROM node:24.21.0-bookworm-slim AS assets
WORKDIR /build
COPY package.json package-lock.json tsconfig.json ./
COPY scripts scripts
COPY src/main/resources/web src/main/resources/web
RUN npm ci && npm run build:assets

FROM eclipse-temurin:25-jdk AS build
WORKDIR /build
COPY mvnw pom.xml ./
COPY .mvn .mvn
RUN chmod +x mvnw && ./mvnw -q -DskipTests dependency:go-offline
COPY src src
COPY --from=assets /build/target/generated-resources target/generated-resources
RUN ./mvnw -q -DskipTests -Dskip.web=true package

FROM eclipse-temurin:25-jre
WORKDIR /app
RUN groupadd --gid 1001 blogdata \
    && useradd --system --uid 10001 --gid blogdata --create-home appuser \
    && install -d -m 0750 -o appuser -g appuser /var/lib/ken-blog/assets /app/content
COPY --from=build /build/target/ken-blog-api-0.0.1-SNAPSHOT.jar /app/app.jar
USER appuser
EXPOSE 8080 8082 8443
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=50", "-jar", "/app/app.jar"]
