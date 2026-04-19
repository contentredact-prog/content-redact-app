import { useEffect, useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, Linking,
} from "react-native";
import { supabase } from "../../lib/supabase";

export default function SettingsScreen() {
  const [email, setEmail] = useState<string>("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setEmail(session?.user?.email || "");
    });
  }, []);

  const handleLogout = () => {
    Alert.alert("Logout", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: async () => {
        await supabase.auth.signOut();
      }},
    ]);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.sectionLabel}>ACCOUNT</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Email</Text>
          <Text style={styles.rowValue}>{email}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Plan</Text>
          <Text style={styles.rowValue}>Free</Text>
        </View>
      </View>

      <Text style={styles.sectionLabel}>ABOUT</Text>
      <View style={styles.card}>
        <TouchableOpacity style={styles.row} onPress={() => Linking.openURL("https://contentredact.com")}>
          <Text style={styles.rowLabel}>Website</Text>
          <Text style={styles.linkText}>contentredact.com →</Text>
        </TouchableOpacity>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Version</Text>
          <Text style={styles.rowValue}>1.0.0</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <Text style={styles.logoutText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000", paddingHorizontal: 16, paddingTop: 20 },
  sectionLabel: { color: "rgba(255,255,255,0.2)", fontSize: 11, fontWeight: "600", letterSpacing: 1.5, marginBottom: 8, marginTop: 20, marginLeft: 4 },
  card: { backgroundColor: "rgba(255,255,255,0.02)", borderWidth: 1, borderColor: "rgba(255,255,255,0.06)", borderRadius: 12, overflow: "hidden" },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14 },
  rowLabel: { color: "rgba(255,255,255,0.6)", fontSize: 14 },
  rowValue: { color: "rgba(255,255,255,0.3)", fontSize: 14 },
  linkText: { color: "#dc2626", fontSize: 14, fontWeight: "500" },
  divider: { height: 1, backgroundColor: "rgba(255,255,255,0.04)", marginHorizontal: 16 },
  logoutBtn: { marginTop: 40, backgroundColor: "rgba(248,113,113,0.1)", borderWidth: 1, borderColor: "rgba(248,113,113,0.2)", paddingVertical: 14, borderRadius: 12, alignItems: "center" },
  logoutText: { color: "#f87171", fontSize: 15, fontWeight: "600" },
});