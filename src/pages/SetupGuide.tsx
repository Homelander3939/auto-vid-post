import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Terminal, Download, FolderOpen, Play, CheckCircle2, AlertTriangle, Globe } from 'lucide-react';

const steps = [
  {
    icon: Download,
    title: '1. Clone the repository',
    description: 'Pull the project from GitHub to your Windows PC.',
    code: 'git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git\ncd YOUR_REPO',
  },
  {
    icon: Terminal,
    title: '2. Install server dependencies',
    description: 'Navigate to the server folder and install Node.js packages.',
    code: 'cd server\nnpm install',
  },
  {
    icon: Download,
    title: '3. Install Playwright browser',
    description: 'Playwright needs a Chromium browser to automate uploads.',
    code: 'npx playwright install chromium',
  },
  {
    icon: FolderOpen,
    title: '4. Configure settings in the app',
    description: 'Open the app in your browser and go to Settings. Fill in your YouTube, TikTok, and Instagram credentials. Set your Telegram bot token and chat ID for notifications.',
    code: null,
  },
  {
    icon: Play,
    title: '5. Start the local server',
    description: 'The server will connect to the cloud database, check for pending jobs every minute, and process them using browser automation.',
    code: 'npm start',
  },
];

export default function SetupGuide() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Local Server Setup</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Step-by-step guide to run the upload server on your Windows PC
        </p>
      </div>

      {/* Prerequisites */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Prerequisites</CardTitle>
          <CardDescription>Make sure you have these installed on your PC</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { name: 'Node.js', version: 'v18+', check: 'node --version' },
              { name: 'Git', version: 'any', check: 'git --version' },
              { name: 'npm', version: 'v9+', check: 'npm --version' },
            ].map((req) => (
              <div key={req.name} className="rounded-lg border p-3">
                <p className="text-sm font-medium">{req.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Version: {req.version}</p>
                <code className="text-xs text-muted-foreground mt-1 block font-mono">{req.check}</code>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Steps */}
      <div className="space-y-4">
        {steps.map((step, idx) => (
          <Card key={idx}>
            <CardContent className="pt-5">
              <div className="flex gap-4">
                <div className="shrink-0 w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                  <step.icon className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold">{step.title}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{step.description}</p>
                  {step.code && (
                    <pre className="mt-3 rounded-lg bg-muted p-3 text-xs font-mono overflow-x-auto whitespace-pre">
                      {step.code}
                    </pre>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* How it works */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="w-4 h-4" />
            How Online + Local Works Together
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <p>
              <span className="font-medium">Queue jobs from anywhere</span> — Use the web app (online or locally) to upload videos and create jobs. Files are stored in the cloud.
            </p>
          </div>
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <p>
              <span className="font-medium">Local server processes uploads</span> — Every minute, the server checks for pending jobs, downloads the video, opens a real browser, logs into YouTube/TikTok/Instagram, and uploads.
            </p>
          </div>
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <p>
              <span className="font-medium">Telegram notifications work from cloud</span> — Notifications are sent via a cloud function, so you get alerts even without the local server running.
            </p>
          </div>
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <p>
              <span className="font-medium">Scheduled campaigns</span> — Use the Campaign tab on Dashboard to schedule uploads at specific times. The local server picks them up when their time comes.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Troubleshooting */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Troubleshooting
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <p className="font-medium">Browser doesn't open</p>
            <p className="text-muted-foreground">Run <code className="bg-muted px-1 rounded text-xs">npx playwright install chromium</code> again</p>
          </div>
          <div>
            <p className="font-medium">Login fails on a platform</p>
            <p className="text-muted-foreground">The first time, Playwright opens a visible browser. Log in manually once — the session is saved for future uploads.</p>
          </div>
          <div>
            <p className="font-medium">Upload stuck as "uploading"</p>
            <p className="text-muted-foreground">Platform UI may have changed. Check server console for errors. The upload scripts may need updating.</p>
          </div>
          <div>
            <p className="font-medium">CAPTCHA or 2FA appears</p>
            <p className="text-muted-foreground">Complete it manually in the browser window. The session will be saved for next time.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}