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

// DDL 생성에 필요한 Hibernate를 빌드 클래스패스에 구성
buildscript {
    repositories { mavenCentral() }
    // API 런타임·통합 테스트·코드 생성 의존성
    dependencies {
        // 앱과 같은 Boot BOM으로 빌드용 Hibernate 버전도 맞춤
        classpath(platform("org.springframework.boot:spring-boot-dependencies:4.1.1"))
        classpath("org.hibernate.orm:hibernate-core")
    }
}

// Kotlin·Spring Boot·jOOQ 빌드 플러그인
plugins {
    kotlin("jvm") version "2.3.21"
    kotlin("plugin.spring") version "2.3.21"
    id("org.springframework.boot") version "4.1.1"
    id("org.jooq.jooq-codegen-gradle") version "3.21.8"
    id("io.spring.dependency-management") version "1.1.7"
}

// 배포 좌표와 jOOQ 버전
group = "io.github.gjaku1031"
version = "0.0.1-SNAPSHOT"
extra["jooq.version"] = "3.21.8"

// 애플리케이션 의존성 저장소
repositories {
    mavenCentral()
}

// JDK·바이트코드 버전과 null·어노테이션 처리 설정
kotlin {
    jvmToolchain(25)
    compilerOptions {
        jvmTarget = JvmTarget.JVM_25
        freeCompilerArgs.addAll("-Xjsr305=strict", "-Xannotation-default-target=param-property")
    }
}

// Spring 플러그인의 all-open 대상에 JPA 타입을 추가하여 프록시 상속·접근자 재정의 허용
allOpen {
    annotation("jakarta.persistence.Entity")
    annotation("jakarta.persistence.MappedSuperclass")
}

// API 실행 진입점
springBoot {
    mainClass = "io.github.gjaku1031.kenblog.KenBlogApiApplicationKt"
}

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation("org.springframework.boot:spring-boot-starter-webmvc")
    implementation("org.springframework.boot:spring-boot-starter-data-jpa")
    implementation("org.springframework.boot:spring-boot-starter-jooq")
    implementation("org.springframework.boot:spring-boot-starter-security")
    implementation("org.springframework.boot:spring-boot-starter-session-jdbc")
    implementation("org.jetbrains.kotlin:kotlin-reflect")
    implementation("tools.jackson.module:jackson-module-kotlin")
    runtimeOnly("com.mysql:mysql-connector-j")
    testImplementation("org.springframework.boot:spring-boot-starter-webmvc-test")
    testImplementation("org.springframework.boot:spring-boot-testcontainers")
    testImplementation("org.testcontainers:testcontainers-mysql")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
    jooqCodegen("org.jooq:jooq-meta-extensions:3.21.8")
}

// 앱 컴파일은 jOOQ 타입에 의존하므로 JPA 모델만 먼저 별도 컴파일함
// 원본 엔티티를 그대로 읽으며 이 소스셋의 클래스는 API JAR에 별도로 넣지 않음
val jpaModel = sourceSets.create("jpaModel")
kotlin.sourceSets.named("jpaModel") {
    kotlin.srcDir("src/main/kotlin")
    // 도메인 예외의 공통 부모만 추가하며 서비스·응답 변환기는 포함하지 않음
    kotlin.include("**/domain/**", "**/global/error/BusinessException.kt")
}
configurations[jpaModel.implementationConfigurationName].extendsFrom(configurations.implementation.get())

// JPA에서 추출할 MySQL DDL 출력 경로
val jpaSchema = layout.buildDirectory.file("generated/jooq/schema.sql")
// 엔티티 선행 컴파일 → DDL 생성 → 리소스 해제 순서의 태스크
val generateJpaSchema by tasks.registering {
    group = "jooq"
    description = "JPA 엔티티에서 jOOQ 코드 생성용 MySQL DDL을 만든다. DB에는 접속하지 않는다."
    dependsOn(jpaModel.classesTaskName)
    inputs.files(jpaModel.runtimeClasspath).withPropertyName("jpaModelClasspath")
        .withNormalizer(ClasspathNormalizer::class)
    outputs.file(jpaSchema)
    doLast {
        // 지난 DDL을 비우고 새 출력 경로 준비
        val output = jpaSchema.get().asFile
        output.parentFile.mkdirs()
        output.delete()
        // DB 접속 없이 MySQL 생성 스크립트만 출력
        val settings = mapOf<String, Any>(
            "hibernate.dialect" to "org.hibernate.dialect.MySQLDialect",
            "hibernate.boot.allow_jdbc_metadata_access" to false,
            "hibernate.physical_naming_strategy" to "org.hibernate.boot.model.naming.PhysicalNamingStrategySnakeCaseImpl",
            "jakarta.persistence.schema-generation.database.action" to "none",
            "jakarta.persistence.schema-generation.scripts.action" to "create",
            "jakarta.persistence.schema-generation.scripts.create-target" to output.absolutePath,
            "hibernate.hbm2ddl.schema-generation.script.append" to false,
        )
        // 빌드 전용 클래스 로더에서 컴파일된 엔티티만 읽음 Spring 앱은 기동하지 않음
        URLClassLoader(jpaModel.runtimeClasspath.map { it.toURI().toURL() }.toTypedArray(),
            Entity::class.java.classLoader).use { loader ->
            val bootstrap = BootstrapServiceRegistryBuilder().applyClassLoader(loader).build()
            val registry = StandardServiceRegistryBuilder(bootstrap).applySettings(settings).build()
            try {
                val sources = MetadataSources(registry)
                // 컴파일된 클래스 중 JPA 엔티티만 이름순으로 수집
                val entities = jpaModel.output.classesDirs.flatMap { directory ->
                    fileTree(directory).matching { include("**/*.class") }.map { file ->
                        file.relativeTo(directory).invariantSeparatorsPath.removeSuffix(".class").replace('/', '.')
                    }
                }.sorted().map { loader.loadClass(it) }.filter { it.isAnnotationPresent(Entity::class.java) }
                check(entities.isNotEmpty()) { "jOOQ 스키마 생성에 사용할 JPA 엔티티가 없습니다." }
                // 등록한 엔티티로 DDL 생성 후 빈 결과 검사
                entities.forEach(sources::addAnnotatedClass)
                SchemaManagementToolCoordinator.process(sources.buildMetadata(), registry, settings,
                    DelayedDropRegistryNotAvailableImpl.INSTANCE)
                check(output.length() > 0) { "Hibernate가 스키마를 생성하지 않았습니다." }
            } finally {
                // 성공·실패 모두 Hibernate 레지스트리 해제
                StandardServiceRegistryBuilder.destroy(registry)
            }
        }
    }
}

// Hibernate가 빌드 중 생성한 DDL을 사용함 수동 스키마나 운영 DB 연결은 필요 없음
jooq {
    configuration {
        generator {
            name = "org.jooq.codegen.KotlinGenerator"
            database {
                name = "org.jooq.meta.extensions.ddl.DDLDatabase"
                // JPA의 EnumType.STRING 계약을 유지하고 별도 jOOQ enum을 만들지 않음
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
                // 조회는 명시적인 JOIN만 사용함 자기 참조 카테고리의 경로 이름 충돌도 방지함
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

// 생성된 jOOQ 소스를 앱 컴파일에 포함
kotlin.sourceSets.main { kotlin.srcDir("build/generated-src/jooq/main") }
// DDL 생성 완료 후 jOOQ 코드 생성
tasks.named("jooqCodegen") {
    dependsOn(generateJpaSchema)
    inputs.file(jpaSchema)
}
// 앱 컴파일 전에 jOOQ 타입 생성 보장
tasks.named("compileKotlin") { dependsOn("jooqCodegen") }

// API JAR에는 화면 자산을 넣지 않고 Pages 빌드에서 npm으로 별도 생성함
sourceSets.main {
    resources {
        exclude("web/**")
    }
}

// JUnit Platform으로 테스트 실행
tasks.withType<Test>().configureEach {
    useJUnitPlatform()
}

// 배포용 실행 JAR 이름 고정
tasks.named<BootJar>("bootJar") {
    archiveFileName = "ken-blog-api.jar"
}

// 기존 운영 이미지와 같은 Noble base 스택을 사용함
tasks.named<BootBuildImage>("bootBuildImage") {
    builder.set("paketobuildpacks/ubuntu-noble-builder:latest")
    runImage.set("paketobuildpacks/ubuntu-noble-run:latest")
    environment.putAll(mapOf(
        "BP_JVM_VERSION" to "25",
    ))
}

// 실행 불가능한 일반 JAR 생성 비활성화
tasks.named<Jar>("jar") {
    enabled = false
}
