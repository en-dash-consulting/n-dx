plugins {
    alias(libs.plugins.spring.boot)
    kotlin("jvm") version "1.9.24"
    id("io.spring.dependency-management") version "1.1.6" apply false
}

group = "com.example"
version = "1.0.0"

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(libs.versions.java.get().toInt()))
    }
}

dependencies {
    implementation(libs.spring.boot.starter.web)
    implementation(platform(libs.spring.boot.bom))
    implementation(libs.jackson.kotlin)
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.8.1")
    implementation(kotlin("stdlib"))
    testImplementation(libs.bundles.testing)
    implementation(libs.missing.entry)
    implementation(libs.broken.ref)
}
