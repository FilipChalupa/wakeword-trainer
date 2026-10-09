import { useEffect, useState } from "react";
import { Alert, Box, Button, Card, CardContent, CardHeader, Chip, Divider, Stack, TextField, Typography } from "@mui/material";
import ShareIcon from "@mui/icons-material/Share";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import RecordVoiceOverIcon from "@mui/icons-material/RecordVoiceOver";
import SaveIcon from "@mui/icons-material/Save";
import QrCode2Icon from "@mui/icons-material/QrCode2";
import { api, type Contributor, type Project } from "../api";
import { errorText, useI18n } from "../i18n";

type Props = {
  project: Project;
  disabled: boolean;
  onSaved: (project: Project) => void;
  onError: (message: string) => void;
  /** a click on a contributor chip filters the recording list to that person */
  onPickContributor?: (name: string) => void;
};

export function ConfigCard({ project, disabled, onSaved, onError, onPickContributor }: Props) {
  const { t } = useI18n();
  const [wakeWord, setWakeWord] = useState(project.wake_word);
  const [target, setTarget] = useState(project.contributor_target ?? 10);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setWakeWord(project.wake_word);
    setTarget(project.contributor_target ?? 10);
  }, [project]);

  const dirty = wakeWord !== project.wake_word || target !== (project.contributor_target ?? 10);

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.saveConfig({ wake_word: wakeWord, contributor_target: target });
      onSaved(res.project);
    } catch (e) {
      onError(errorText(t, e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader avatar={<RecordVoiceOverIcon color="primary" />} title={t("config.title")} subheader={t("config.subtitle")} />
      <CardContent>
        <Stack spacing={2}>
          <TextField label={t("config.wakeWord")} value={wakeWord} onChange={(e) => setWakeWord(e.target.value)} placeholder="chaloupko" fullWidth disabled={disabled} helperText={t("config.wakeWordHelp")} />

          <TextField
            size="small"
            type="number"
            label={t("config.target")}
            value={target}
            onChange={(e) => setTarget(Math.max(1, Number(e.target.value)))}
            inputProps={{ min: 1 }}
            disabled={disabled}
            helperText={t("config.targetHelp")}
            sx={{ maxWidth: 320 }}
          />

          <Stack direction="row" spacing={2} alignItems="center">
            <Button variant="contained" startIcon={<SaveIcon />} onClick={save} disabled={disabled || saving || !dirty || !wakeWord.trim()}>
              {t("config.save")}
            </Button>
            <Typography variant="body2" color="text.secondary">
              {dirty ? t("config.unsaved") : t("config.saved")}
            </Typography>
          </Stack>

          <Divider />
          <ShareSection project={project} onSaved={onSaved} onError={onError} onPickContributor={onPickContributor} />
        </Stack>
      </CardContent>
    </Card>
  );
}

function ShareSection({ project, onSaved, onError, onPickContributor }: { project: Project; onSaved: (p: Project) => void; onError: (m: string) => void; onPickContributor?: (name: string) => void }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [contributors, setContributors] = useState<Contributor[]>([]);
  const link = project.share_token ? `${location.origin}/contribute?token=${project.share_token}` : null;

  useEffect(() => {
    if (!link) {
      setQr(null);
      return;
    }
    import("qrcode")
      .then((QRCode) => QRCode.toDataURL(link, { width: 220, margin: 1 }))
      .then(setQr)
      .catch(() => setQr(null));
  }, [link]);

  useEffect(() => {
    const load = () => api.contributors().then((r) => setContributors(r.items)).catch(() => undefined);
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [project.id]);

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    try {
      const res = await api.setShare(project.id, enabled);
      onSaved({ ...project, share_token: res.share_token });
    } catch (e) {
      onError(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onError(link);
    }
  };

  const totalPositive = contributors.reduce((a, c) => a + c.positive, 0);
  const top = contributors[0];
  const imbalance = top && totalPositive >= 10 && top.positive / totalPositive >= 0.8 ? { share: Math.round((top.positive / totalPositive) * 100), name: top.name === "owner" ? t("share.owner") : top.name } : null;

  return (
    <Box>
      {imbalance && (
        <Alert severity="warning" variant="outlined" sx={{ mb: 1.5 }}>
          {t("share.imbalance", imbalance)}
        </Alert>
      )}
      <Stack direction="row" spacing={1} alignItems="center">
        <ShareIcon fontSize="small" color="primary" />
        <Typography variant="subtitle2">{t("share.title")}</Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1 }}>
        {t("share.help")} {t("share.https")}
      </Typography>
      {link ? (
        <Stack spacing={1}>
          <TextField size="small" value={link} fullWidth InputProps={{ readOnly: true }} onFocus={(e) => e.target.select()} />
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button variant="outlined" startIcon={<ContentCopyIcon />} onClick={copy}>
              {copied ? t("share.copied") : t("share.copy")}
            </Button>
            <Button variant="outlined" startIcon={<QrCode2Icon />} onClick={() => setShowQr((v) => !v)} disabled={!qr}>
              {t("share.qr")}
            </Button>
            <Button color="error" startIcon={<LinkOffIcon />} onClick={() => toggle(false)} disabled={busy}>
              {t("share.disable")}
            </Button>
          </Stack>
        </Stack>
      ) : (
        <Button variant="outlined" startIcon={<ShareIcon />} onClick={() => toggle(true)} disabled={busy}>
          {t("share.enable")}
        </Button>
      )}
      {showQr && qr && link && (
        <Box sx={{ mt: 1 }}>
          <img src={qr} alt="QR" width={220} height={220} style={{ borderRadius: 8, background: "#fff", padding: 4 }} />
        </Box>
      )}
      {contributors.length > 0 && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }} alignItems="center">
          <Typography variant="caption" color="text.secondary">
            {t("share.contributors")} ({t("share.clickToFilter")}):
          </Typography>
          {contributors.map((c) => (
            <Chip
              key={c.name}
              size="small"
              variant="outlined"
              color={c.name !== "owner" && c.positive >= (project.contributor_target ?? 10) ? "success" : "default"}
              label={`${c.name === "owner" ? t("share.owner") : c.name}: ${c.positive}${c.negative ? ` (+${c.negative})` : ""}`}
              onClick={onPickContributor ? () => onPickContributor(c.name) : undefined}
            />
          ))}
        </Stack>
      )}
    </Box>
  );
}
