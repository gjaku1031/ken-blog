import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.springframework.boot.gradle.tasks.bundling.BootJar

plugins {
    kotlin("jvm") version "2.3.21"
    kotlin("plugin.spring") version "2.3.21"
    id("org.springframework.boot") version "4.1.1"
    id("io.spring.dependency-management") version "1.1.7"
}

group = "io.github.gjaku1031"
version = "0.0.1-SNAPSHOT"

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
}

// Docker와 Pages는 npm으로 만든 자산을 재사용한다.
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
    description = "관리자와 공개 화면 자산을 컴파일합니다."
    dependsOn(checkWeb)
    commandLine(npm, "run", "build:assets")
    inputs.files("package.json", "package-lock.json", "tsconfig.json", "scripts/build-web.mjs")
    inputs.dir("src/main/resources/web")
    outputs.dirs(layout.buildDirectory.dir("generated-resources"), layout.buildDirectory.dir("public-assets"))
    onlyIf { !skipWeb.get() }
}

sourceSets.main {
    resources {
        exclude("web/**")
        srcDir(layout.buildDirectory.dir("generated-resources"))
    }
}

tasks.processResources {
    dependsOn(buildWeb)
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
