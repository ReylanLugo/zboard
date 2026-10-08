import { expect, test } from 'claude-code/testing'

import { INFRA_CLIS, infraCommandOf } from './infra.ts'

test('the guarded list names every infrastructure CLI', () => {
  expect([...INFRA_CLIS].sort()).toEqual([
    'ansible-playbook', 'aws', 'az', 'bq', 'cdk', 'doctl', 'eksctl', 'firebase', 'flyctl', 'gcloud', 'gsutil', 'helm',
    'heroku', 'kubectl', 'netlify', 'pulumi', 'sam', 'serverless', 'terraform', 'terragrunt', 'tofu', 'vercel', 'wrangler',
  ])
})

const DETECTED: ReadonlyArray<readonly [string, string]> = [
  ['gcloud compute instances list', 'gcloud'],
  ['  terraform apply', 'terraform'],
  ['cd infra && terraform plan', 'terraform'],
  ['ls; kubectl get pods', 'kubectl'],
  ['false || helm install x y', 'helm'],
  ['echo hi | aws s3 ls', 'aws'],
  ['(az login)', 'az'],
  ['echo $(gcloud config list)', 'gcloud'],
  ['echo `gsutil ls`', 'gsutil'],
  ['echo "$(bq ls)"', 'bq'],
  ['echo ok\ntofu apply', 'tofu'],
  ['FOO=1 gcloud x', 'gcloud'],
  ['A=1 B="two words" pulumi up', 'pulumi'],
  ['sudo terragrunt apply', 'terragrunt'],
  ['sudo -u root kubectl delete ns x', 'kubectl'],
  ['env FOO=1 doctl compute droplet list', 'doctl'],
  ['env -i flyctl deploy', 'flyctl'],
  ['command heroku logs', 'heroku'],
  ['exec eksctl get cluster', 'eksctl'],
  ['echo a | xargs -n 1 cdk deploy', 'cdk'],
  ['nohup sam deploy &', 'sam'],
  ['time serverless deploy', 'serverless'],
  ['npx -y wrangler deploy', 'wrangler'],
  ['bash -c "gcloud auth list"', 'gcloud'],
  ["sh -c 'cd x && terraform destroy'", 'terraform'],
  ['zsh -lc "firebase deploy"', 'firebase'],
  ['bash -c "bash -c \'vercel --prod\'"', 'vercel'],
  ['eval "netlify deploy"', 'netlify'],
  ['/usr/bin/gcloud version', 'gcloud'],
  ['./terraform init', 'terraform'],
  ['"gcloud" version', 'gcloud'],
  ['if aws sts get-caller-identity; then echo y; fi', 'aws'],
  ['ansible-playbook site.yml', 'ansible-playbook'],
  ['rg x 2>&1 | kubectl apply -f -', 'kubectl'],
  ['echo a & gcloud x', 'gcloud'],
]

test('detects an infrastructure CLI in command position', () => {
  for (const [command, cli] of DETECTED) expect([command, infraCommandOf(command)]).toEqual([command, cli])
})

const ALLOWED: readonly string[] = [
  'rg gcloud src/',
  'git log --grep=terraform',
  'cat terraform.tf',
  'echo "kubectl"',
  "echo 'aws is a cli'",
  "echo '$(gcloud x)'",
  'echo gcloud; ls',
  'ls aws-config.ts',
  'node scripts/aws-config.ts',
  './aws-config.ts',
  'FOO=gcloud env',
  'sudo ls terraform',
  'xargs -n 1 echo gcloud',
  'bash -c "echo gcloud"',
  'bash script.sh gcloud',
  'git commit -m "bump helm chart"',
  'bunx tsc -p .',
  'ptest hooks/domain/infra.test.ts',
  'echo azure',
  'ls /usr/bin/gcloud-docs',
  '',
  '   ',
]

test('allows the same names as arguments, file names and quoted text', () => {
  for (const command of ALLOWED) expect([command, infraCommandOf(command)]).toEqual([command, undefined])
})
