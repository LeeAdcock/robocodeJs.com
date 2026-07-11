# Ops runbook — monitoring & alerts

Everything here targets the **`robocode-prod`** Elastic Beanstalk environment in
**us-east-1** (account `095207682014`). All alerts notify SNS topic
**`Alerts`** → confirmed email **lee@katieandlee.com**.

## What alerts exist

| Where defined                                       | Alarms                                                                                                                                                    | Notifies |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `server/.ebextensions/cloudwatch-alarms.config`     | Security log events: `sandbox.catastrophic`, `process.fatal`, `bot.fault timedOut`, `auth.forbidden`, `rate.limited`                                      | `Alerts` |
| `server/.ebextensions/cloudwatch-ops-alarms.config` | ALB unhealthy-hosts + ELB/target 5xx; RDS free-storage / CPU / connections / freeable-memory; EC2 CPU + CPU-credits; `db.error` / `http.error` log events | `Alerts` |
| `server/.ebextensions/options.config`               | EB environment events (deploy failure, environment-degraded, instance replace) via `aws:elasticbeanstalk:sns:topics`                                      | `Alerts` |
| Legacy (console)                                    | `awsbilling-AWS-Service-Charges-total` ($15/6h)                                                                                                           | `Alerts` |
| **This runbook (below)**                            | External `/health` canary; host memory (CW agent); CodePipeline failure                                                                                   | `Alerts` |

The `.ebextensions` alarms deploy automatically through the CodePipeline → EB
pipeline. **A malformed `.config` fails the deploy** (EB auto-rolls-back); the
alarms are additive CloudFormation resources, no app/runtime change.

## Verify the `.ebextensions` alarms after a deploy

```sh
export AWS_DEFAULT_REGION=us-east-1
# All robocodejs-* alarms exist and are OK, each wired to the Alerts topic:
aws cloudwatch describe-alarms --alarm-name-prefix robocodejs- \
  --query "MetricAlarms[].[AlarmName,StateValue,AlarmActions[0]]" --output table
# EB environment health stayed Green through the deploy:
aws elasticbeanstalk describe-environments --environment-names robocode-prod \
  --query "Environments[0].[Health,Status]" --output text
```

**Prove an email actually arrives** (no incident needed) — force one alarm, watch
for the email, then reset:

```sh
aws cloudwatch set-alarm-state --alarm-name robocodejs-alb-unhealthy-hosts \
  --state-value ALARM --state-reason "manual delivery test"
# ...confirm the email landed, then:
aws cloudwatch set-alarm-state --alarm-name robocodejs-alb-unhealthy-hosts \
  --state-value OK --state-reason "reset after test"
```

## Follow-up 1 — external uptime canary (recommended)

Catches DNS / TLS / load-balancer / edge outages the in-AWS alarms can't see.
Deploy the standalone stack once:

```sh
aws cloudformation deploy \
  --region us-east-1 \
  --stack-name robocodejs-canary \
  --template-file ops/synthetics-canary.cfn.yaml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides HealthUrl=https://robocodejs.com/health
```

Then test it: `aws cloudwatch set-alarm-state --alarm-name robocodejs-canary-health
--state-value ALARM --state-reason test` and confirm the email. Tear down with
`aws cloudformation delete-stack --stack-name robocodejs-canary` (empty the
`robocodejs-canary-artifacts-*` bucket first).

## Follow-up 2 — CodePipeline deploy-failure notifications

So a failed deploy pages you. (The `github-cloudspaces` IAM user is denied
`codestar-notifications`; run this with an admin identity or use the console.)

Console: CodePipeline → your pipeline → **Notify → Create notification rule** →
events **"Pipeline execution: Failed"** (and optionally Canceled/Superseded) →
target the **`Alerts`** SNS topic. CLI equivalent:

```sh
aws codestar-notifications create-notification-rule \
  --name robocodejs-pipeline-failed \
  --resource "arn:aws:codepipeline:us-east-1:095207682014:<PIPELINE_NAME>" \
  --detail-type BASIC \
  --event-type-ids codepipeline-pipeline-pipeline-execution-failed \
  --targets TargetType=SNS,TargetAddress=arn:aws:sns:us-east-1:095207682014:Alerts
```

Note: the SNS topic policy must allow `codestar-notifications.amazonaws.com` to
publish (the console wizard adds this automatically).

## Follow-up 3 — host memory monitoring (CloudWatch agent)

The app's `event=metrics` heartbeat logs `rssMB`, but the EB stdout line is
syslog-prefixed, so a CloudWatch **log metric filter cannot parse the number**.
Host memory therefore needs the CloudWatch agent, which also needs an IAM grant
the default EB instance profile lacks.

1. Attach `CloudWatchAgentServerPolicy` to the EB EC2 instance role
   (`aws-elasticbeanstalk-ec2-role`, or whatever
   `aws:autoscaling:launchconfiguration → IamInstanceProfile` points to):
   ```sh
   aws iam attach-role-policy --role-name aws-elasticbeanstalk-ec2-role \
     --policy-arn arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy
   ```
2. Add an `.ebextensions` config that installs + configures the agent to publish
   `mem_used_percent` (and `swap_used_percent`) to namespace `CWAgent`, then add
   a `mem_used_percent > 85` alarm → `Alerts`. Verify the metric appears
   (`aws cloudwatch list-metrics --namespace CWAgent`) before trusting it.

Until then, memory pressure is covered indirectly: `robocodejs-ec2-cpu` /
`robocodejs-ec2-cpu-credits` (swap-thrash shows as CPU), `robocodejs-rds-freeable-memory`,
and `robocodejs-process-fatal` (an OOM crash). A 1 GB swapfile
(`.ebextensions/swap.config`) also cushions transient spikes.

## Tuning

Thresholds are conservative starting points. After a week of a normal load,
review `aws cloudwatch describe-alarm-history` and the metrics, and raise/lower
thresholds (especially `rds-connections`, `alb-target-5xx`, `http-error`) to fit
the observed baseline.
