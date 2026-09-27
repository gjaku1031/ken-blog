FROM eclipse-temurin:25-jdk AS build
WORKDIR /build
COPY mvnw pom.xml ./
COPY .mvn .mvn
RUN chmod +x mvnw && ./mvnw -q -DskipTests dependency:go-offline
COPY src src
RUN ./mvnw -q -DskipTests package

FROM eclipse-temurin:25-jre
WORKDIR /app
RUN useradd --system --uid 10001 --create-home appuser
COPY --from=build /build/target/ken-blog-api-0.0.1-SNAPSHOT.jar /app/app.jar
USER appuser
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=70", "-jar", "/app/app.jar"]
