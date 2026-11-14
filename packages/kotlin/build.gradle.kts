import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    kotlin("jvm") version "2.2.21"
    `java-library`
    id("com.vanniktech.maven.publish") version "0.34.0"
}

repositories { mavenCentral() }

kotlin {
    explicitApi()
    compilerOptions { jvmTarget.set(JvmTarget.JVM_1_8) }
}

java {
    sourceCompatibility = JavaVersion.VERSION_1_8
    targetCompatibility = JavaVersion.VERSION_1_8
}

dependencies {
    testImplementation(kotlin("test"))
}

tasks.test {
    useJUnitPlatform()
    systemProperty("pubba.conformance", rootDir.resolve("../../conformance").absolutePath)
    testLogging { events("failed"); exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL }
}

mavenPublishing {
    publishToMavenCentral()
    if (providers.gradleProperty("signingInMemoryKey").isPresent || providers.gradleProperty("signing.keyId").isPresent) signAllPublications()
    coordinates("com.tharinduathapaththu", "pubba", version.toString())
    pom {
        name.set("pubba")
        description.set("A small brain for showroom sites and apps: related items with reasons, what-next from a visitor's trail, typo-tolerant matching and a headless guide, from a compiled pubba bundle.")
        url.set("https://github.com/Tharindu127/pubba")
        inceptionYear.set("2026")
        licenses {
            license {
                name.set("MIT License")
                url.set("https://opensource.org/licenses/MIT")
                distribution.set("repo")
            }
        }
        developers {
            developer {
                id.set("Tharindu127")
                name.set("Tharindu Athapaththu")
                url.set("https://github.com/Tharindu127")
            }
        }
        scm {
            url.set("https://github.com/Tharindu127/pubba")
            connection.set("scm:git:https://github.com/Tharindu127/pubba.git")
            developerConnection.set("scm:git:ssh://git@github.com/Tharindu127/pubba.git")
        }
    }
}
