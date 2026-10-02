import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.springframework.boot.gradle.tasks.bundling.BootJar
import org.springframework.boot.gradle.tasks.bundling.BootBuildImage
import jakarta.persistence.Entity
import org.hibernate.boot.MetadataSources
import org.hibernate.boot.registry.BootstrapServiceRegistryBuilder
import org.hibernate.boot.registry.StandardServiceRegistryBuilder
import org.hibernate.tool.schema.spi.DelayedDropRegistryNotAvailableImpl
import org.hibernate.tool.schema.spi.SchemaManagementToolCoordinator
import java.net.URLClassLoader

buildscript {
    repositories { mavenCentral() }
    dependencies {
        // 앱과 같은 Boot BOM으로 빌드용 Hibernate 버전도 맞춘다.
        classpath(platform("org.springframework.boot:spring-boot-dependencies:4.1.1"))
        classpath("org.hibernate.orm:hibernate-core")
    }
}

plugins {
    kotlin("jvm") version "2.3.21"
    kotlin("plugin.spring") version "2.3.21"
    id("org.springframework.boot") version "4.1.1"
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

// 앱 컴파일은 jOOQ 타입에 의존하므로 JPA 모델만 먼저 별도 컴파일한다.
// 원본 엔티티를 그대로 읽으며 이 소스셋의 클래스는 API JAR에 별도로 넣지 않는다.
val jpaModel = sourceSets.create("jpaModel")
kotlin.sourceSets.named("jpaModel") {
    kotlin.srcDir("src/main/kotlin")
    // 도메인 예외의 공통 부모만 추가하며 서비스·응답 변환기는 포함하지 않는다.
    kotlin.include("**/domain/**", "**/global/error/BusinessException.kt")
}
configurations[jpaModel.implementationConfigurationName].extendsFrom(configurations.implementation.get())

val jpaSchema = layout.buildDirectory.file("generated/jooq/schema.sql")
val generateJpaSchema by tasks.registering {
    group = "jooq"
    description = "JPA 엔티티에서 jOOQ 코드 생성용 MySQL DDL을 만든다. DB에는 접속하지 않는다."
    dependsOn(jpaModel.classesTaskName)
    inputs.files(jpaModel.runtimeClasspath).withPropertyName("jpaModelClasspath")
        .withNormalizer(ClasspathNormalizer::class)
    outputs.file(jpaSchema)
    doLast {
        val output = jpaSchema.get().asFile
        output.parentFile.mkdirs()
        output.delete()
        val settings = mapOf<String, Any>(
            "hibernate.dialect" to "org.hibernate.dialect.MySQLDialect",
            "hibernate.boot.allow_jdbc_metadata_access" to false,
            "hibernate.physical_naming_strategy" to "org.hibernate.boot.model.naming.PhysicalNamingStrategySnakeCaseImpl",
            "jakarta.persistence.schema-generation.database.action" to "none",
            "jakarta.persistence.schema-generation.scripts.action" to "create",
            "jakarta.persistence.schema-generation.scripts.create-target" to output.absolutePath,
            "hibernate.hbm2ddl.schema-generation.script.append" to false,
        )
        // 빌드 전용 클래스 로더에서 컴파일된 엔티티만 읽는다. Spring 앱은 기동하지 않는다.
        URLClassLoader(jpaModel.runtimeClasspath.map { it.toURI().toURL() }.toTypedArray(),
            Entity::class.java.classLoader).use { loader ->
            val bootstrap = BootstrapServiceRegistryBuilder().applyClassLoader(loader).build()
            val registry = StandardServiceRegistryBuilder(bootstrap).applySettings(settings).build()
            try {
                val sources = MetadataSources(registry)
                val entities = jpaModel.output.classesDirs.flatMap { directory ->
                    fileTree(directory).matching { include("**/*.class") }.map { file ->
                        file.relativeTo(directory).invariantSeparatorsPath.removeSuffix(".class").replace('/', '.')
                    }
                }.sorted().map { loader.loadClass(it) }.filter { it.isAnnotationPresent(Entity::class.java) }
                check(entities.isNotEmpty()) { "jOOQ 스키마 생성에 사용할 JPA 엔티티가 없습니다." }
                entities.forEach(sources::addAnnotatedClass)
                SchemaManagementToolCoordinator.process(sources.buildMetadata(), registry, settings,
                    DelayedDropRegistryNotAvailableImpl.INSTANCE)
                check(output.length() > 0) { "Hibernate가 스키마를 생성하지 않았습니다." }
            } finally {
                StandardServiceRegistryBuilder.destroy(registry)
            }
        }
    }
}

// Hibernate가 빌드 중 생성한 DDL을 사용한다. 수동 스키마나 운영 DB 연결은 필요 없다.
jooq {
    configuration {
        generator {
            name = "org.jooq.codegen.KotlinGenerator"
            database {
                name = "org.jooq.meta.extensions.ddl.DDLDatabase"
                // JPA의 EnumType.STRING 계약을 유지하고 별도 jOOQ enum을 만들지 않는다.
                forcedTypes {
                    forcedType { name = "VARCHAR"; includeTypes = "(?i:ENUM.*)" }
                }
                properties {
                    property { key = "scripts"; value = jpaSchema.get().asFile.absolutePath }
                    property { key = "unqualifiedSchema"; value = "none" }
                    property { key = "defaultNameCase"; value = "lower" }
                }
            }
            generate {
                isPojos = false
                isDaos = false
                // 조회는 명시적인 JOIN만 사용한다. 자기 참조 카테고리의 경로 이름 충돌도 방지한다.
                isImplicitJoinPathsToOne = false
                isImplicitJoinPathsToMany = false
                isImplicitJoinPathsManyToMany = false
            }
            target {
                packageName = "io.github.gjaku1031.kenblog.jooq"
                directory = "build/generated-src/jooq/main"
            }
        }
    }
}

kotlin.sourceSets.main { kotlin.srcDir("build/generated-src/jooq/main") }
tasks.named("jooqCodegen") {
    dependsOn(generateJpaSchema)
    inputs.file(jpaSchema)
}
tasks.named("compileKotlin") { dependsOn("jooqCodegen") }

// API JAR에는 화면 자산을 넣지 않고 Pages 빌드에서 npm으로 별도 생성한다.
sourceSets.main {
    resources {
        exclude("web/**")
    }
}

tasks.withType<Test>().configureEach {
    useJUnitPlatform()
}

tasks.named<BootJar>("bootJar") {
    archiveFileName = "ken-blog-api.jar"
}

// java.desktop 이미지 처리에 필요한 공유 라이브러리가 있는 Noble base 스택을 사용한다.
tasks.named<BootBuildImage>("bootBuildImage") {
    builder.set("paketobuildpacks/ubuntu-noble-builder:latest")
    runImage.set("paketobuildpacks/ubuntu-noble-run:latest")
    environment.putAll(mapOf(
        "BP_JVM_VERSION" to "25",
    ))
}

tasks.named<Jar>("jar") {
    enabled = false
}
