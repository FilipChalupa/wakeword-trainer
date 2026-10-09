import { useEffect, useRef, useState } from "react";
import { Alert, Box, Button, Card, CardContent, CardHeader, Chip, Collapse, Stack, TextField, Typography } from "@mui/material";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DownloadIcon from "@mui/icons-material/Download";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import DeveloperBoardIcon from "@mui/icons-material/DeveloperBoard";
import MemoryIcon from "@mui/icons-material/Memory";
import DnsIcon from "@mui/icons-material/Dns";
import { api, type DeviceEvent, type PublicTarget, type PublicUrls, type TrainingTarget } from "../api";
import { errorText, useI18n } from "../i18n";

type Props = { projectId: string; jobsVersion: number; onError: (m: string) => void };

/** Deployment: one section per platform with a model (ESPHome manifest URL, Wyoming model URL), ESP device events and version check. */
export function DeployCard({ projectId, jobsVersion, onError }: Props) {
  const { t } = useI18n();
  const [urls, setUrls] = useState<PublicUrls | null>(null);
  const [events, setEvents] = useState<DeviceEvent[]>([]);
  const [outdated, setOutdated] = useState<string[]>([]);
  const [minVersion, setMinVersion] = useState("2024.7.0");
  const since = useRef<string | undefined>(undefined);

  useEffect(() => {
    api.publicUrls(projectId).then(setUrls).catch((e) => onError(errorText(t, e)));
  }, [projectId, jobsVersion, onError, t]);

  useEffect(() => {
    since.current = undefined;
    setEvents([]);
    const poll = () =>
      api
        .deviceEvents(since.current)
        .then((r) => {
          if (r.items.length) setEvents((prev) => [...r.items.slice().reverse(), ...prev].slice(0, 50));
          since.current = r.now;
          setOutdated(r.outdated_versions);
          setMinVersion(r.minimum_esphome_version);
        })
        .catch(() => undefined);
    poll();
    const timer = setInterval(poll, 3000);
    return () => clearInterval(timer);
  }, [projectId]);

  const esphome = urls?.targets.esphome;
  const shown: TrainingTarget[] = urls ? (["esphome", "wyoming"] as TrainingTarget[]).filter((k) => urls.targets[k].has_model) : [];

  return (
    <Card>
      <CardHeader avatar={<RocketLaunchIcon color="primary" />} title={t("deploy.title")} subheader={t("deploy.subtitle")} />
      <CardContent>
        <Stack spacing={2}>
          {urls && !urls.has_model && <Alert severity="info">{t("deploy.noModel")}</Alert>}
          {urls && shown.map((k) => <TargetSection key={k} target={k} info={urls.targets[k]} minVersion={urls.minimum_esphome_version} lastEventAt={events[0]?.at ?? null} />)}
          {urls && urls.has_model && shown.length === 1 && (
            <Typography variant="caption" color="text.secondary">
              {t("deploy.otherTarget", { target: t(shown[0] === "esphome" ? "target.short.wyoming" : "target.short.esphome") })}
            </Typography>
          )}

          {esphome?.has_model && (
          <Box>
            <Stack direction="row" spacing={1} alignItems="center">
              <DeveloperBoardIcon fontSize="small" color="primary" />
              <Typography variant="subtitle2">{t("deploy.devices")}</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {t("deploy.devicesHelp")}
            </Typography>
            {outdated.length > 0 && (
              <Alert severity="warning" sx={{ mb: 1 }}>
                {t("deploy.outdated", { versions: outdated.join(", "), min: minVersion })}
              </Alert>
            )}
            {events.length === 0 ? (
              <Typography variant="caption" color="text.secondary">
                {t("deploy.noEvents")}
              </Typography>
            ) : (
              <Stack spacing={0.5} sx={{ maxHeight: 200, overflow: "auto" }}>
                {events.map((e, i) => (
                  <Stack key={`${e.at}-${i}`} direction="row" spacing={1} alignItems="center">
                    <Typography variant="caption" color="text.secondary" sx={{ minWidth: 80 }}>
                      {new Date(e.at).toLocaleTimeString()}
                    </Typography>
                    <Chip size="small" color="secondary" variant="outlined" label={t("monitor.source.device", { device: e.device })} />
                    <Typography variant="body2">{e.wake_word}</Typography>
                    {e.esphome_version && (
                      <Typography variant="caption" color="text.secondary">
                        ESPHome {e.esphome_version}
                      </Typography>
                    )}
                  </Stack>
                ))}
              </Stack>
            )}
          </Box>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

/** URL, copy button and the collapsible snippet of one platform's latest model. */
function TargetSection({ target, info, minVersion, lastEventAt }: { target: TrainingTarget; info: PublicTarget; minVersion: string; lastEventAt: string | null }) {
  const { t } = useI18n();
  const [showSnippet, setShowSnippet] = useState(false);
  const [copied, setCopied] = useState(false);
  const wyoming = target === "wyoming";
  // ESPHome bakes the model in at build time: until a device reports a detection newer than the model, it still runs the old one
  const needsReflash = !wyoming && !!info.finished_at && (!lastEventAt || lastEventAt < info.finished_at);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(info.snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setShowSnippet(true);
    }
  };

  return (
    <Box sx={{ p: 1.5, border: "1px solid", borderColor: "divider", borderRadius: 2 }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
        {wyoming ? <DnsIcon fontSize="small" color="primary" /> : <MemoryIcon fontSize="small" color="primary" />}
        <Typography variant="subtitle2">{t(wyoming ? "deploy.section.wyoming" : "deploy.section.esphome")}</Typography>
        {info.finished_at && <Chip size="small" variant="outlined" label={t("deploy.modelFrom", { date: new Date(info.finished_at).toLocaleString() })} />}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {wyoming ? t("deploy.wyomingHelp") : t("deploy.help")}
      </Typography>
      <Stack spacing={1}>
        {needsReflash && (
          <Alert severity="info" variant="outlined">
            {t("deploy.reflash", { date: new Date(info.finished_at as string).toLocaleString() })}
          </Alert>
        )}
        <TextField size="small" label={wyoming ? t("deploy.modelUrl") : t("deploy.manifest")} value={info.url} fullWidth InputProps={{ readOnly: true }} onFocus={(e) => e.target.select()} />
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
          {wyoming && (
            <Button variant="outlined" startIcon={<DownloadIcon />} href={info.url} download={`${info.slug}.tflite`}>
              {t("deploy.download")}
            </Button>
          )}
          <Button variant="outlined" startIcon={<ContentCopyIcon />} onClick={copy}>
            {copied ? t("share.copied") : wyoming ? t("deploy.copyWyoming") : t("deploy.copy")}
          </Button>
          <Button startIcon={showSnippet ? <ExpandLessIcon /> : <ExpandMoreIcon />} onClick={() => setShowSnippet((v) => !v)}>
            {wyoming ? t("deploy.snippetWyoming") : t("deploy.snippet")}
          </Button>
          {!wyoming && <Chip size="small" variant="outlined" label={t("deploy.minVersion", { min: minVersion })} />}
        </Stack>
        <Collapse in={showSnippet}>
          <Box component="pre" sx={{ m: 0, p: 1.5, borderRadius: 2, bgcolor: (th) => (th.palette.mode === "dark" ? "#05080f" : "#0f172a"), color: "#cbd5e1", fontSize: 11, overflowX: "auto" }}>
            {info.snippet}
          </Box>
        </Collapse>
        {!wyoming && (
          <Typography variant="caption" color="text.secondary">
            {t("deploy.https")}
          </Typography>
        )}
      </Stack>
    </Box>
  );
}
