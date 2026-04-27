# Microsoft SignalR + Jackson reflection
-keep class com.microsoft.signalr.** { *; }
-keep class com.fasterxml.jackson.** { *; }
-keepattributes Signature, RuntimeVisibleAnnotations, RuntimeInvisibleAnnotations

# Kotlinx Serialization
-keepattributes *Annotation*, InnerClasses
-keep,includedescriptorclasses class com.remotedesktop.agent.**$$serializer { *; }
-keepclassmembers class com.remotedesktop.agent.** {
    *** Companion;
}
-keepclasseswithmembers class com.remotedesktop.agent.** {
    kotlinx.serialization.KSerializer serializer(...);
}
