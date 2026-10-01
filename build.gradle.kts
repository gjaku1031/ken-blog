import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.springframework.boot.gradle.tasks.aot.ProcessAot
import org.springframework.boot.gradle.tasks.bundling.BootJar
import org.springframework.boot.gradle.tasks.bundling.BootBuildImage

plugins {
    kotlin("jvm") version "2.3.21"
    kotlin("plugin.spring") version "2.3.21"
    id("org.springframework.boot") version "4.1.1"
    id("org.graalvm.buildtools.native") version "1.1.14"
    id("org.jooq.jooq-codegen-gradle") version "3.21.8"
    id("io.spring.dependency-management") version "1.1.7"
}

group = "io.github.gjaku1031"
version = "0.0.1-SNAPSHOT"
extra["jooq.version"] = "3.21.8"

repositories {
    mavenCentral()
}

kotlin {
    jvmToolchain(25)
    compilerOptions {
        jvmTarget = JvmTarget.JVM_25
        freeCompilerArgs.addAll("-Xjsr305=strict", "-Xannotation-default-target=param-property")
    }
}

springBoot {
    mainClass = "io.github.gjaku1031.kenblog.KenBlogApiApplicationKt"
}

dependencyManagement {
    imports {
        mavenBom("org.springframework.ai:spring-ai-bom:2.0.1")
    }
}

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation("org.springframework.boot:spring-boot-starter-webmvc")
    implementation("org.springframework.boot:spring-boot-starter-thymeleaf")
    implementation("org.springframework.boot:spring-boot-starter-data-jpa")
    implementation("org.springframework.boot:spring-boot-starter-jooq")
    implementation("org.springframework.boot:spring-boot-starter-security")
    implementation("org.springframework.boot:spring-boot-starter-session-jdbc")
    implementation("org.springframework.ai:spring-ai-starter-mcp-server-webmvc")
    implementation("org.jetbrains.kotlin:kotlin-reflect")
    implementation("tools.jackson.module:jackson-module-kotlin")
    runtimeOnly("com.mysql:mysql-connector-j")
    testImplementation("org.springframework.boot:spring-boot-starter-webmvc-test")
    testImplementation("org.springframework.boot:spring-boot-testcontainers")
    testImplementation("org.testcontainers:testcontainers-mysql")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
    jooqCodegen("org.jooq:jooq-meta-extensions:3.21.8")
}

// 조회용 Kotlin 테이블 타입은 로컬 DDL로 생성하며 운영 DB에 연결하지 않는다.
jooq {
    configuration {
        generator {
            name = "org.jooq.codegen.KotlinGenerator"
            database {
                name = "org.jooq.meta.extensions.ddl.DDLDatabase"
                properties {
                    property { key = "scripts"; value = "src/jooq/schema.sql" }
                    property { key = "unqualifiedSchema"; value = "none" }
                    property { key = "defaultNameCase"; value = "lower" }
                }
            }
            generate { isPojos = false; isDaos = false }
            target {
                packageName = "io.github.gjaku1031.kenblog.jooq"
                directory = "build/generated-src/jooq/main"
            }
        }
    }
}

kotlin.sourceSets.main { kotlin.srcDir("build/generated-src/jooq/main") }
tasks.named("jooqCodegen") { inputs.file("src/jooq/schema.sql") }
tasks.named("compileKotlin") { dependsOn("jooqCodegen") }

// API JAR에는 화면 자산을 넣지 않고 Pages 빌드에서 npm으로 별도 생성한다.
val skipWeb = providers.gradleProperty("skipWeb").map(String::toBoolean).orElse(false)
val npm = if (System.getProperty("os.name").startsWith("Windows")) "npm.cmd" else "npm"

val installWeb by tasks.registering(Exec::class) {
    group = "build"
    description = "고정된 npm 의존성을 설치합니다."
    commandLine(npm, "ci")
    inputs.files("package.json", "package-lock.json")
    outputs.dir("node_modules")
    onlyIf { !skipWeb.get() }
}

val checkWeb by tasks.registering(Exec::class) {
    group = "verification"
    description = "TypeScript 타입을 검사합니다."
    dependsOn(installWeb)
    commandLine(npm, "run", "typecheck")
    onlyIf { !skipWeb.get() }
}

val buildWeb by tasks.registering(Exec::class) {
    group = "build"
    description = "Pages 관리자와 공개 화면 자산을 컴파일합니다."
    dependsOn(checkWeb)
    commandLine(npm, "run", "build:assets")
    inputs.files("package.json", "package-lock.json", "tsconfig.json", "src/main/resources/web/build.mjs")
    inputs.dir("src/main/resources/web")
    outputs.dirs(layout.buildDirectory.dir("admin-assets"), layout.buildDirectory.dir("public-assets"))
    onlyIf { !skipWeb.get() }
}

sourceSets.main {
    resources {
        exclude("web/**")
    }
}

tasks.check {
    dependsOn(checkWeb)
}

tasks.withType<Test>().configureEach {
    useJUnitPlatform()
}

tasks.named<BootJar>("bootJar") {
    archiveFileName = "ken-blog-api.jar"
}

// AOT의 조건부 MCP Bean을 포함하고 운영 자격 증명 없이 caddy 구성을 분석한다.
tasks.named<ProcessAot>("processAot") {
    environment("SPRING_PROFILES_ACTIVE", "caddy")
    environment("APP_MCP_ENABLED", "true")
    environment("DB_URL", "jdbc:mysql://127.0.0.1:1/kenblog_native_aot?connectTimeout=1000")
    environment("DB_USERNAME", "native_build")
    environment("DB_PASSWORD", "native_build")
}

// java.desktop 이미지 처리에 필요한 공유 라이브러리가 있는 Noble base 스택을 사용한다.
tasks.named<BootBuildImage>("bootBuildImage") {
    builder.set("paketobuildpacks/ubuntu-noble-builder:latest")
    runImage.set("paketobuildpacks/ubuntu-noble-run:latest")
    environment.putAll(mapOf(
        "BP_NATIVE_IMAGE" to "true",
        "BP_JVM_VERSION" to "25",
        "BP_NATIVE_IMAGE_BUILD_ARGUMENTS" to "--no-fallback -J-Xmx6g -J-XX:-UseParallelGC -J-XX:+UseG1GC -march=compatibility",
    ))
}

tasks.named<Jar>("jar") {
    enabled = false
}

// Node의 Pages 빌더가 Spring 컨텍스트와 DB를 시작하지 않고 Kotlin 템플릿 생성기를 실행한다.
val writeSiteClasspath by tasks.registering {
    group = "build"
    description = "독립형 Pages 생성기의 런타임 클래스패스를 기록합니다."
    dependsOn(tasks.classes)
    val output = layout.buildDirectory.file("site-runtime-classpath.txt")
    inputs.files(sourceSets.main.get().runtimeClasspath)
    outputs.file(output)
    doLast {
        output.get().asFile.apply {
            parentFile.mkdirs()
            writeText(sourceSets.main.get().runtimeClasspath.asPath)
        }
    }
}
