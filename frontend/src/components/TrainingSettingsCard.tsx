import { useEffect, useState } from "react";
import { Accordion, AccordionDetails, AccordionSummary, Box, Button, Card, CardContent, CardHeader, FormControlLabel, MenuItem, Stack, Switch, TextField, Typography } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import TuneIcon from "@mui/icons-material/Tune";
import SaveIcon from "@mui/icons-material/Save";
import { api, type Project, type TrainingParams } from "../api";
import { errorText, useI18n, type TKey } from "../i18n";

type Props = {
  project: Project;
  defaults: TrainingParams;
  disabled: boolean;
  onSaved: (project: Project) => void;
  onError: (message: string) => void;
};

const FIELDS: { key: keyof TrainingParams; step?: number; min?: number }[] = [
  { key: "training_steps", step: 100, min: 100 },
  { key: "learning_rate", step: 0.0001, min: 0.00001 },
  { key: "batch_size", step: 16, min: 16 },
  { key: "eval_step_interval", step: 50, min: 25 },
  { key: "augmentations_per_sample", step: 5, min: 1 },
  { key: "clip_duration_ms", step: 100, min: 800 },
  { key: "negative_class_weight", step: 1, min: 1 },
];

/** Training settings: default platform, parameters and the webhook. Lives in the Training tab. */
export function TrainingSettingsCard({ project, defaults, disabled, onSaved, onError }: Props) {
  const { t } = useI18n();
  const [training, setTraining] = useState<TrainingParams>(project.training);
  const [webhook, setWebhook] = useState(project.webhook_url ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTraining(project.training);
    setWebhook(project.webhook_url ?? "");
  }, [project]);

  const dirty = webhook !== (project.webhook_url ?? "") || JSON.stringify(training) !== JSON.stringify(project.training);

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.saveConfig({ training, webhook_url: webhook });
      onSaved(res.project);
    } catch (e) {
      onError(errorText(t, e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader avatar={<TuneIcon color="primary" />} title={t("tsettings.title")} subheader={t("tsettings.subtitle")} />
      <CardContent>
        <Stack spacing={2}>
          <TextField
            select
            label={t("config.platform")}
            value={training.target ?? "esphome"}
            onChange={(e) => setTraining({ ...training, target: e.target.value as TrainingParams["target"] })}
            disabled={disabled}
            helperText={t("config.platformHelp")}
          >
            <MenuItem value="esphome">{t("target.esphome")}</MenuItem>
            <MenuItem value="wyoming">{t("target.wyoming")}</MenuItem>
          </TextField>

          <Accordion disableGutters variant="outlined">
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="subtitle2">{t("config.trainingParams")}</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "1fr 1fr 1fr" } }}>
                {FIELDS.map((f) => (
                  <TextField
                    key={f.key}
                    type="number"
                    label={t(`config.f.${f.key}` as TKey)}
                    value={training[f.key]}
                    onChange={(e) => setTraining({ ...training, [f.key]: Number(e.target.value) })}
                    inputProps={{ step: f.step, min: f.min }}
                    helperText={t(`config.h.${f.key}` as TKey)}
                    disabled={disabled}
                    size="small"
                  />
                ))}
              </Box>
              <FormControlLabel
                sx={{ mt: 1 }}
                control={<Switch checked={!!training.hard_negatives} onChange={(e) => setTraining({ ...training, hard_negatives: e.target.checked })} disabled={disabled} />}
                label={
                  <Box>
                    <Typography variant="body2">{t("config.f.hard_negatives")}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t("config.h.hard_negatives")}
                    </Typography>
                  </Box>
                }
              />
              <Button size="small" sx={{ mt: 1 }} onClick={() => setTraining({ ...defaults })} disabled={disabled}>
                {t("config.resetDefaults")}
              </Button>
            </AccordionDetails>
          </Accordion>

          <TextField size="small" label={t("config.webhook")} value={webhook} onChange={(e) => setWebhook(e.target.value)} helperText={t("config.webhookHelp")} disabled={disabled} placeholder="https://homeassistant.local:8123/api/webhook/…" />

          <Stack direction="row" spacing={2} alignItems="center">
            <Button variant="contained" startIcon={<SaveIcon />} onClick={save} disabled={disabled || saving || !dirty}>
              {t("config.save")}
            </Button>
            <Typography variant="body2" color="text.secondary">
              {dirty ? t("config.unsaved") : t("config.saved")}
            </Typography>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
