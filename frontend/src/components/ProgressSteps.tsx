import { Box, Step, StepButton, StepLabel, Stepper, Typography } from "@mui/material";
import { type Job, type TrainingState } from "../api";
import { useI18n } from "../i18n";

export type TabId = "data" | "train" | "test" | "deploy";
type Props = { positive: number; recommended: number; jobs: Job[]; state: TrainingState; tab: TabId; onGo: (tab: TabId) => void };

/** Where the project stands: samples recorded, training, test, deployment; clickable. */
export function ProgressSteps({ positive, recommended, jobs, state, tab, onGo }: Props) {
  const { t } = useI18n();
  const running = ["downloading", "preparing", "training", "converting"].includes(state.status);
  const trained = jobs.some((j) => !!j.model_url);
  const steps: { id: TabId; label: string; detail: string; done: boolean }[] = [
    { id: "data", label: t("steps.data"), detail: t("steps.dataDetail", { n: positive, goal: recommended }), done: positive >= recommended },
    { id: "train", label: t("steps.train"), detail: running ? t("steps.trainRunning", { step: state.step, total: state.total_steps }) : trained ? t("steps.trainDone", { n: jobs.length }) : positive > 0 ? t("steps.trainReady") : t("steps.trainWaiting"), done: trained },
    { id: "test", label: t("steps.test"), detail: trained ? t("steps.testReady") : t("steps.afterTraining"), done: false },
    { id: "deploy", label: t("steps.deploy"), detail: trained ? t("steps.deployReady") : t("steps.afterTraining"), done: false },
  ];
  const active = steps.findIndex((s) => !s.done);
  return (
    <Box sx={{ px: { xs: 0, sm: 1 }, pb: 1 }}>
      <Stepper nonLinear activeStep={active < 0 ? steps.length : active} alternativeLabel sx={{ "& .MuiStepLabel-label": { mt: 0.5 } }}>
        {steps.map((s) => (
          <Step key={s.id} completed={s.done} active={tab === s.id}>
            <StepButton onClick={() => onGo(s.id)} sx={{ py: 0.5 }}>
              <StepLabel>
                <Typography variant="body2" fontWeight={tab === s.id ? 700 : 500} lineHeight={1.2}>
                  {s.label}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" lineHeight={1.2}>
                  {s.detail}
                </Typography>
              </StepLabel>
            </StepButton>
          </Step>
        ))}
      </Stepper>
    </Box>
  );
}
