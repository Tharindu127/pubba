pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "pubba-android-sample"
include(":app")

// The library from this repository; an app of your own uses com.tharinduathapaththu:pubba from Maven Central.
includeBuild("../../packages/kotlin")
