package io.github.gjaku1031.kenblog.codegen

import jakarta.persistence.Entity
import org.hibernate.boot.MetadataSources
import org.hibernate.boot.registry.StandardServiceRegistryBuilder
import org.hibernate.tool.schema.spi.SchemaManagementToolCoordinator
import org.hibernate.tool.schema.spi.DelayedDropRegistryNotAvailableImpl
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider
import org.springframework.core.type.filter.AnnotationTypeFilter
import java.nio.file.Files
import java.nio.file.Path

/** 실제 앱과 같은 Hibernate·MySQL 매핑으로 코드 생성용 DDL만 출력. JDBC 연결·데이터 변경 없음. */
fun main(args: Array<String>) {
    val output = Path.of(args.single()).toAbsolutePath()
    Files.createDirectories(output.parent)
    Files.deleteIfExists(output)
    val settings = mapOf<String, Any>(
        "hibernate.dialect" to "org.hibernate.dialect.MySQLDialect",
        "hibernate.boot.allow_jdbc_metadata_access" to false,
        "hibernate.physical_naming_strategy" to "org.hibernate.boot.model.naming.PhysicalNamingStrategySnakeCaseImpl",
        "jakarta.persistence.schema-generation.database.action" to "none",
        "jakarta.persistence.schema-generation.scripts.action" to "create",
        "jakarta.persistence.schema-generation.scripts.create-target" to output.toString(),
        "hibernate.hbm2ddl.schema-generation.script.append" to false,
    )
    val registry = StandardServiceRegistryBuilder().applySettings(settings).build()
    try {
        val scanner = ClassPathScanningCandidateComponentProvider(false)
        scanner.addIncludeFilter(AnnotationTypeFilter(Entity::class.java))
        val entities = scanner.findCandidateComponents("io.github.gjaku1031.kenblog")
        check(entities.isNotEmpty()) { "jOOQ 스키마 생성에 사용할 JPA 엔티티가 없습니다." }
        val sources = MetadataSources(registry)
        entities.map { it.beanClassName!! }.sorted().forEach { sources.addAnnotatedClass(Class.forName(it)) }
        SchemaManagementToolCoordinator.process(
            sources.buildMetadata(), registry, settings, DelayedDropRegistryNotAvailableImpl.INSTANCE,
        )
        check(Files.size(output) > 0) { "Hibernate가 스키마를 생성하지 않았습니다." }
    } finally {
        StandardServiceRegistryBuilder.destroy(registry)
    }
}
