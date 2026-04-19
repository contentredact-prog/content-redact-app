import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Linking,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { supabase } from "../../lib/supabase";
import { uploadFile } from "../../lib/api";

type UploadState = "idle" | "uploading" | "done" | "error";

interface SelectedFile {
  uri: string;
  name: string;
  type: string;
  size?: number;
}

export default function UploadScreen() {
  const [file, setFile] = useState<SelectedFile | null>(null);
  const [state, setState] = useState<UploadState>("idle");
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pickVideo = async () => {
    const { status } =
      await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Permission Required",
        "Content Redact needs access to your media library to protect your videos.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings() },
        ]
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["videos"],
      quality: 1,
      videoMaxDuration: 600,
    });

    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setFile({
        uri: asset.uri,
        name: asset.fileName || `video_${Date.now()}.mp4`,
        type: asset.mimeType || "video/mp4",
        size: asset.fileSize,
      });
      setState("idle");
      setDownloadUrl(null);
      setError(null);
    }
  };

  const pickAudio = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["audio/mpeg", "audio/wav", "audio/mp3", "audio/x-wav"],
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        setFile({
          uri: asset.uri,
          name: asset.name,
          type: asset.mimeType || "audio/mpeg",
          size: asset.size,
        });
        setState("idle");
        setDownloadUrl(null);
        setError(null);
      }
    } catch {
      Alert.alert("Error", "Failed to pick audio file");
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setState("uploading");
    setError(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const owner = session?.user?.email || "Unknown";

      const result = await uploadFile(file.uri, file.name, file.type, owner);

      if (result.download_url) setDownloadUrl(result.download_url);
      setState("done");
    } catch (e: any) {
      setState("error");
      setError(e.message || "Upload failed");
    }
  };

  const handleDownload = () => {
    if (downloadUrl) Linking.openURL(downloadUrl);
  };

  const resetUpload = () => {
    setFile(null);
    setState("idle");
    setDownloadUrl(null);
    setError(null);
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return "";
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <View style={styles.container}>
      {/* File pickers */}
      {!file && state === "idle" && (
        <View style={styles.section}>
          <Text style={styles.hint}>Select a file to protect</Text>

          <TouchableOpacity style={styles.pickerBtn} onPress={pickVideo}>
            <Text style={styles.pickerIcon}>▶</Text>
            <View>
              <Text style={styles.pickerTitle}>Choose Video</Text>
              <Text style={styles.pickerSub}>MP4 from your camera roll</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.pickerBtn} onPress={pickAudio}>
            <Text style={styles.pickerIcon}>♫</Text>
            <View>
              <Text style={styles.pickerTitle}>Choose Audio</Text>
              <Text style={styles.pickerSub}>MP3 or WAV files</Text>
            </View>
          </TouchableOpacity>
        </View>
      )}

      {/* Selected file */}
      {file && state === "idle" && (
        <View style={styles.section}>
          <View style={styles.fileBox}>
            <Text style={styles.fileName} numberOfLines={2}>
              {file.name}
            </Text>
            <Text style={styles.fileMeta}>
              {file.type.includes("video") ? "Video" : "Audio"}
              {file.size ? ` · ${formatSize(file.size)}` : ""}
            </Text>
          </View>

          <TouchableOpacity style={styles.uploadBtn} onPress={handleUpload}>
            <Text style={styles.uploadBtnText}>Upload & Protect</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={resetUpload}>
            <Text style={styles.removeText}>Remove file</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Uploading */}
      {state === "uploading" && (
        <View style={styles.section}>
          <ActivityIndicator size="large" color="#dc2626" />
          <Text style={styles.statusTitle}>Protecting your content...</Text>
          <Text style={styles.statusSub}>
            Hashing → Fingerprinting → Stamping metadata
          </Text>
        </View>
      )}

      {/* Error */}
      {state === "error" && (
        <View style={styles.section}>
          <Text style={styles.errorTitle}>Protection Failed</Text>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={handleUpload}>
            <Text style={styles.retryText}>Try Again</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={resetUpload}>
            <Text style={styles.removeText}>Choose different file</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Success */}
      {state === "done" && (
        <View style={styles.section}>
          <Text style={styles.successIcon}>✓</Text>
          <Text style={styles.successTitle}>Protection Complete</Text>
          <Text style={styles.successSub}>
            Fingerprinted and metadata-tagged.{"\n"}Background scan in
            progress.
          </Text>

          {downloadUrl && (
            <TouchableOpacity
              style={styles.downloadBtn}
              onPress={handleDownload}
            >
              <Text style={styles.downloadText}>↓ Download Protected File</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.newBtn} onPress={resetUpload}>
            <Text style={styles.newBtnText}>Protect Another File</Text>
          </TouchableOpacity>

          {downloadUrl && (
            <Text style={styles.expiryNote}>
              Download link expires in 1 hour. File deleted after 48 hours.
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000", paddingHorizontal: 20, justifyContent: "center" },
  section: { alignItems: "center", gap: 12 },
  hint: { color: "rgba(255,255,255,0.3)", fontSize: 14, marginBottom: 12 },
  pickerBtn: {
    width: "100%", flexDirection: "row", alignItems: "center", gap: 16,
    backgroundColor: "rgba(255,255,255,0.03)", borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)", borderRadius: 12, padding: 20, marginBottom: 4,
  },
  pickerIcon: { fontSize: 24, color: "rgba(255,255,255,0.4)" },
  pickerTitle: { color: "rgba(255,255,255,0.8)", fontSize: 15, fontWeight: "600" },
  pickerSub: { color: "rgba(255,255,255,0.25)", fontSize: 12, marginTop: 2 },
  fileBox: {
    width: "100%", backgroundColor: "rgba(255,255,255,0.02)", borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)", borderRadius: 12, padding: 20, alignItems: "center",
  },
  fileName: { color: "rgba(255,255,255,0.8)", fontSize: 14, fontWeight: "500", textAlign: "center", marginBottom: 4 },
  fileMeta: { color: "rgba(255,255,255,0.3)", fontSize: 12 },
  uploadBtn: {
    width: "100%", backgroundColor: "#dc2626", paddingVertical: 16,
    borderRadius: 12, alignItems: "center",
  },
  uploadBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  removeText: { color: "rgba(255,255,255,0.2)", fontSize: 12, marginTop: 4 },
  statusTitle: { color: "rgba(255,255,255,0.8)", fontSize: 16, fontWeight: "600" },
  statusSub: { color: "rgba(255,255,255,0.3)", fontSize: 12, textAlign: "center" },
  errorTitle: { color: "#f87171", fontSize: 16, fontWeight: "600" },
  errorText: { color: "rgba(248,113,113,0.6)", fontSize: 13, textAlign: "center" },
  retryBtn: {
    width: "100%", backgroundColor: "rgba(220,38,38,0.15)", borderWidth: 1,
    borderColor: "rgba(220,38,38,0.3)", paddingVertical: 14, borderRadius: 12, alignItems: "center",
  },
  retryText: { color: "#f87171", fontSize: 14, fontWeight: "600" },
  successIcon: { fontSize: 48, color: "#34d399" },
  successTitle: { color: "#34d399", fontSize: 18, fontWeight: "700" },
  successSub: { color: "rgba(52,211,153,0.5)", fontSize: 12, textAlign: "center", lineHeight: 18 },
  downloadBtn: {
    width: "100%", backgroundColor: "rgba(220,38,38,0.15)", borderWidth: 1,
    borderColor: "rgba(220,38,38,0.3)", paddingVertical: 14, borderRadius: 12, alignItems: "center",
  },
  downloadText: { color: "#f87171", fontSize: 14, fontWeight: "600" },
  newBtn: {
    width: "100%", backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)", paddingVertical: 14, borderRadius: 12, alignItems: "center",
  },
  newBtnText: { color: "rgba(255,255,255,0.6)", fontSize: 14, fontWeight: "500" },
  expiryNote: { color: "rgba(255,255,255,0.12)", fontSize: 10, textAlign: "center", marginTop: 8 },
});