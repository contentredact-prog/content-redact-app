import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from "react-native";
import { supabase } from "../lib/supabase";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";

// Tells the browser to successfully close once Google is done
WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
  const handleOAuthLogin = async (provider: "google" | "apple") => {
    try {
      // 1. Generate the exact Deep Link back to this Expo app
      const redirectUrl = "https://contentredact.com/auth/callback";
    

      // 2. Ask Supabase for the Google/Apple login URL
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: redirectUrl,
          skipBrowserRedirect: true, // Forces manual browser handling
        },
      });

      if (error) throw error;

      // 3. Open the secure in-app browser
      if (data?.url) {
        const result = await WebBrowser.openAuthSessionAsync(
          data.url,
          redirectUrl
        );

        // 4. Safely parse the returning Expo URL without crashing Android
        if (result.type === "success" && result.url) {
          const hashPart = result.url.split("#")[1];
          
          if (hashPart) {
            const params = new URLSearchParams(hashPart);
            const accessToken = params.get("access_token");
            const refreshToken = params.get("refresh_token");

            // 5. Lock in the session!
            if (accessToken && refreshToken) {
              await supabase.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken,
              });
            }
          }
        }
      }
    } catch (e: any) {
      Alert.alert("Login Error", e.message || "Something went wrong");
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.logoBox}>
        <Text style={styles.logoText}>CR</Text>
      </View>

      <Text style={styles.title}>Welcome to{"\n"}Content Redact</Text>
      <Text style={styles.subtitle}>Sign in to protect your content</Text>

      <TouchableOpacity
        style={styles.googleBtn}
        onPress={() => handleOAuthLogin("google")}
      >
        <Text style={styles.googleText}>Continue with Google</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.appleBtn}
        onPress={() => handleOAuthLogin("apple")}
      >
        <Text style={styles.appleText}>Continue with Apple</Text>
      </TouchableOpacity>

      <Text style={styles.footer}>
        By continuing, you agree to Content Redact's{"\n"}Terms of Service and
        Privacy Policy
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  logoBox: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: "#991b1b",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 28,
  },
  logoText: { color: "#fff", fontSize: 20, fontWeight: "900" },
  title: {
    color: "#fff",
    fontSize: 26,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    color: "rgba(255,255,255,0.3)",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 36,
  },
  googleBtn: {
    width: "100%",
    backgroundColor: "#fff",
    paddingVertical: 15,
    borderRadius: 10,
    alignItems: "center",
    marginBottom: 12,
  },
  googleText: { color: "#000", fontSize: 15, fontWeight: "600" },
  appleBtn: {
    width: "100%",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    paddingVertical: 15,
    borderRadius: 10,
    alignItems: "center",
    marginBottom: 12,
  },
  appleText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  footer: {
    color: "rgba(255,255,255,0.12)",
    fontSize: 11,
    textAlign: "center",
    marginTop: 28,
    lineHeight: 16,
  },
});