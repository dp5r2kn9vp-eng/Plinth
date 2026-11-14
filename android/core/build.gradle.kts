// Plattformunabhängiger Kern des Android-Players: Offline-Empfang (Protokoll wie player/src/offline.js),
// Ablage, Kopplung, Suche im Netz und lokaler Webserver für die Oberfläche. Läuft auf Android und auf
// jeder JVM (Tests, Interop-Test mit Plinth Studio).
plugins {
    id("org.jetbrains.kotlin.jvm")
    application
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}
kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }

dependencies {
    // Auf Android ist org.json Teil der Plattform (dort ausgeschlossen), auf der JVM kommt es als Bibliothek.
    implementation("org.json:json:20250517")
    testImplementation(kotlin("test"))
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.4")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

application {
    mainClass.set("de.klangniveau.plinth.core.MainKt")
    applicationName = "plinth-core"
}

tasks.test { useJUnitPlatform() }
