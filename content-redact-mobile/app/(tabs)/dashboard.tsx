import { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, Alert, Linking, Share,
} from "react-native";
import {
  listWorks, getMatches, triggerScan, generateDMCA,
  deleteWork, updateMatchStatus, certificateUrl,
  type Work, type Match,
} from "../../lib/api";

function StageLabel({ stage }: { stage?: string }) {
  const map: Record<string, { label: string; color: string }> = {
    fingerprinted: { label: "🛡 Fingerprinted", color: "#34d399" },
    transcribing: { label: "📝 Transcribing...", color: "#fbbf24" },
    scanning: { label: "🔍 Scanning...", color: "#60a5fa" },
    monitoring: { label: "📡 Monitoring", color: "#34d399" },
    failed: { label: "✗ Error", color: "#f87171" },
  };
  const s = map[stage || "fingerprinted"] || map.fingerprinted;
  return <Text style={[styles.stageText, { color: s.color }]}>{s.label}</Text>;
}

function WorkCard({ work, onRefresh }: { work: Work; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(false);

  const loadMatches = async () => {
    setLoading(true);
    try { setMatches(await getMatches(work.id)); } catch {}
    setLoading(false);
  };

  const handleExpand = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) loadMatches();
  };

  const handleScan = async () => {
    try {
      await triggerScan(work.id);
      Alert.alert("Scan Started", "Checking the web for your content...");
      setTimeout(() => { loadMatches(); onRefresh(); }, 12000);
    } catch (e: any) { Alert.alert("Error", e.message); }
  };

  const handleDMCA = async (matchUrl: string) => {
    try {
      const notice = await generateDMCA(work.id, matchUrl);
      Alert.alert("DMCA Notice Generated", "Share or copy the notice", [
        { text: "Share", onPress: () => Share.share({ message: notice.notice_text }) },
        { text: "Cancel", style: "cancel" },
      ]);
    } catch { Alert.alert("Error", "Failed to generate DMCA notice"); }
  };

  const handleDelete = () => {
    Alert.alert("Delete Work", "This removes all data permanently.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try { await deleteWork(work.id); onRefresh(); } catch {}
      }},
    ]);
  };

  const matchCount = work.matches_found || 0;

  return (
    <TouchableOpacity style={styles.card} onPress={handleExpand} activeOpacity={0.7}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle} numberOfLines={1}>{work.title}</Text>
          <View style={styles.cardMeta}>
            <Text style={styles.metaText}>{work.media_type === "audio" ? "♫" : "▶"} {work.id.slice(0, 8)}</Text>
            <StageLabel stage={work.processing_stage} />
          </View>
        </View>
        {matchCount > 0 && (
          <View style={styles.matchBadge}>
            <Text style={styles.matchBadgeText}>{matchCount} match{matchCount > 1 ? "es" : ""}</Text>
          </View>
        )}
      </View>

      {expanded && (
        <View style={styles.cardBody}>
          {work.transcript && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>TRANSCRIPT</Text>
              <Text style={styles.transcriptText} numberOfLines={4}>{work.transcript.slice(0, 200)}...</Text>
            </View>
          )}
          {work.original_hash && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>SHA-256</Text>
              <Text style={styles.hashText}>{work.original_hash}</Text>
            </View>
          )}
          {matches.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>MATCHES ({matches.length})</Text>
              {matches.map((m) => (
                <View key={m.id} style={styles.matchRow}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", gap: 6, marginBottom: 2 }}>
                      <Text style={styles.matchPlatform}>{m.platform}</Text>
                      <Text style={styles.matchStatus}>{m.review_status.replace(/_/g, " ")}</Text>
                    </View>
                    <Text style={styles.matchUrl} numberOfLines={1}>{m.match_url}</Text>
                  </View>
                  {m.review_status === "pending" && (
                    <TouchableOpacity onPress={() => updateMatchStatus(m.id, "confirmed_infringement").then(loadMatches)}>
                      <Text style={styles.confirmBtn}>Confirm</Text>
                    </TouchableOpacity>
                  )}
                  {m.review_status === "confirmed_infringement" && (
                    <TouchableOpacity onPress={() => handleDMCA(m.match_url)}>
                      <Text style={styles.dmcaBtn}>DMCA</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </View>
          )}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.actionBtn} onPress={() => Linking.openURL(certificateUrl(work.id))}>
              <Text style={styles.actionText}>📄 Certificate</Text>
            </TouchableOpacity>
            {work.processing_stage === "monitoring" && (
              <TouchableOpacity style={styles.actionBtn} onPress={handleScan}>
                <Text style={styles.actionText}>🔍 Re-scan</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[styles.actionBtn, { borderColor: "rgba(248,113,113,0.2)" }]} onPress={handleDelete}>
              <Text style={[styles.actionText, { color: "rgba(248,113,113,0.5)" }]}>Delete</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function DashboardScreen() {
  const [works, setWorks] = useState<Work[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchWorks = useCallback(async () => {
    try { setWorks(await listWorks()); } catch {}
    setRefreshing(false);
  }, []);

  useEffect(() => {
    fetchWorks();
    const interval = setInterval(fetchWorks, 10000);
    return () => clearInterval(interval);
  }, [fetchWorks]);

  const totalMatches = works.reduce((s, w) => s + (w.matches_found || 0), 0);
  const protectedCount = works.filter((w) => w.processing_status === "protected").length;

  return (
    <View style={styles.container}>
      <View style={styles.statsRow}>
        {[
          { label: "Works", value: works.length, color: "rgba(255,255,255,0.6)" },
          { label: "Protected", value: protectedCount, color: "#34d399" },
          { label: "Matches", value: totalMatches, color: totalMatches > 0 ? "#f87171" : "rgba(255,255,255,0.2)" },
        ].map((s) => (
          <View key={s.label} style={styles.statBox}>
            <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>
      <FlatList
        data={works}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <WorkCard work={item} onRefresh={fetchWorks} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchWorks(); }} tintColor="#dc2626" />}
        contentContainerStyle={{ paddingBottom: 40 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>↑</Text>
            <Text style={styles.emptyText}>No works yet</Text>
            <Text style={styles.emptyHint}>Upload your first file to get started</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000", paddingHorizontal: 16 },
  statsRow: { flexDirection: "row", gap: 8, marginVertical: 16 },
  statBox: { flex: 1, backgroundColor: "rgba(255,255,255,0.02)", borderWidth: 1, borderColor: "rgba(255,255,255,0.05)", borderRadius: 12, padding: 14 },
  statValue: { fontSize: 22, fontWeight: "700" },
  statLabel: { color: "rgba(255,255,255,0.2)", fontSize: 10, fontWeight: "600", letterSpacing: 1, marginTop: 4 },
  card: { backgroundColor: "rgba(255,255,255,0.01)", borderWidth: 1, borderColor: "rgba(255,255,255,0.06)", borderRadius: 12, padding: 16, marginBottom: 10 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  cardTitle: { color: "rgba(255,255,255,0.8)", fontSize: 14, fontWeight: "600" },
  cardMeta: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },
  metaText: { color: "rgba(255,255,255,0.2)", fontSize: 11 },
  stageText: { fontSize: 11, fontWeight: "500" },
  matchBadge: { backgroundColor: "rgba(248,113,113,0.15)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  matchBadgeText: { color: "#f87171", fontSize: 11, fontWeight: "700" },
  cardBody: { marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.04)" },
  section: { marginBottom: 14 },
  sectionLabel: { color: "rgba(255,255,255,0.2)", fontSize: 10, fontWeight: "600", letterSpacing: 1, marginBottom: 6 },
  transcriptText: { color: "rgba(255,255,255,0.3)", fontSize: 12, lineHeight: 18, backgroundColor: "rgba(255,255,255,0.02)", padding: 10, borderRadius: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.04)", overflow: "hidden" },
  hashText: { color: "rgba(255,255,255,0.2)", fontSize: 10, fontFamily: "monospace" },
  matchRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.04)" },
  matchPlatform: { color: "rgba(248,113,113,0.7)", fontSize: 10, fontWeight: "700", backgroundColor: "rgba(248,113,113,0.1)", paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4, overflow: "hidden" },
  matchStatus: { color: "rgba(255,255,255,0.3)", fontSize: 10 },
  matchUrl: { color: "rgba(255,255,255,0.4)", fontSize: 11 },
  confirmBtn: { color: "#fbbf24", fontSize: 11, fontWeight: "600" },
  dmcaBtn: { color: "#f87171", fontSize: 11, fontWeight: "700", backgroundColor: "rgba(248,113,113,0.15)", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, overflow: "hidden" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  actionBtn: { backgroundColor: "rgba(255,255,255,0.03)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  actionText: { color: "rgba(255,255,255,0.4)", fontSize: 11, fontWeight: "500" },
  empty: { alignItems: "center", paddingTop: 80 },
  emptyIcon: { fontSize: 40, color: "rgba(255,255,255,0.08)", marginBottom: 12 },
  emptyText: { color: "rgba(255,255,255,0.25)", fontSize: 14, marginBottom: 4 },
  emptyHint: { color: "rgba(255,255,255,0.12)", fontSize: 12 },
});