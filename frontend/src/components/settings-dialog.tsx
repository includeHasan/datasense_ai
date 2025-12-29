"use client";

import * as React from "react";
import { Settings, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { ApiError, getLlmAccount, saveLlmAccount, clearLlmAccount } from "@/lib/api";
import type { LlmAccount } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface SettingsDialogProps {
  token: string;
  /** Lets a parent open the dialog programmatically (e.g. after a 402). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Settings dialog for the freemium / bring-your-own-LLM feature. Shows the
 * user's free-query usage for the month, and lets them attach their own
 * OpenAI-compatible credentials (API key + optional base URL + model) to get
 * unlimited usage on their own provider. Follows the same base-nova
 * `<DialogTrigger render={...}>` pattern used by ReportDialog / the schema
 * dialog in app-sidebar.tsx.
 *
 * The stored key is never displayed (there is no way to read it back); the
 * form is only ever for setting a new one.
 */
export function SettingsDialog({ token, open: controlledOpen, onOpenChange }: SettingsDialogProps) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = controlledOpen ?? internalOpen;

  const [account, setAccount] = React.useState<LlmAccount | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [apiKey, setApiKey] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState("");
  const [model, setModel] = React.useState("");
  const [isSaving, setIsSaving] = React.useState(false);
  const [isClearing, setIsClearing] = React.useState(false);

  const loadAccount = React.useCallback(() => {
    setIsLoading(true);
    getLlmAccount(token)
      .then((data) => {
        setAccount(data);
        setBaseUrl(data.baseUrl ?? "");
        setModel(data.model ?? "");
      })
      .catch((error) => {
        const message = error instanceof ApiError ? error.message : "Failed to load settings.";
        toast.error(message);
      })
      .finally(() => setIsLoading(false));
  }, [token]);

  function handleOpenChange(next: boolean) {
    if (onOpenChange) onOpenChange(next);
    else setInternalOpen(next);
    if (next) {
      setApiKey("");
      loadAccount();
    }
  }

  async function handleSave() {
    if (!apiKey.trim() || !model.trim()) {
      toast.error("An API key and a model name are both required.");
      return;
    }
    setIsSaving(true);
    try {
      const updated = await saveLlmAccount(token, {
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim() || undefined,
        model: model.trim(),
      });
      setAccount(updated);
      setApiKey("");
      toast.success("Your API key is saved. You now have unlimited usage on your own key.");
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Failed to save your API key.";
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleClear() {
    setIsClearing(true);
    try {
      const updated = await clearLlmAccount(token);
      setAccount(updated);
      setApiKey("");
      setBaseUrl("");
      setModel("");
      toast.success("Removed your key. You're back on the free tier.");
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Failed to remove your API key.";
      toast.error(message);
    } finally {
      setIsClearing(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={<Button variant="ghost" size="sm" className="justify-start gap-2" />}
      >
        <Settings />
        Settings
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>LLM settings &amp; usage</DialogTitle>
          <DialogDescription>
            Every account gets {account?.freeQueriesLimit ?? 5} free queries per month. After that,
            add your own OpenAI-compatible key to keep going - unlimited, on your own provider.
          </DialogDescription>
        </DialogHeader>

        {isLoading && !account ? (
          <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading your usage...
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-border bg-background p-3 text-sm">
              {account?.hasOwnKey ? (
                <p className="text-foreground">
                  Using your own API key
                  {account.model ? (
                    <>
                      {" "}
                      (<span className="font-mono">{account.model}</span>)
                    </>
                  ) : null}{" "}
                  - unlimited usage.
                </p>
              ) : (
                <p className="text-foreground">
                  <span className="font-medium">
                    {account?.freeQueriesUsed ?? 0} of {account?.freeQueriesLimit ?? 5}
                  </span>{" "}
                  free queries used this month.
                </p>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="settings-api-key">API key</Label>
                <Input
                  id="settings-api-key"
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  disabled={isSaving || isClearing}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={account?.hasOwnKey ? "Enter a new key to replace the stored one" : "sk-..."}
                />
                <p className="text-xs text-muted-foreground">
                  Stored encrypted; never shown again after saving.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="settings-base-url">Base URL (optional)</Label>
                <Input
                  id="settings-base-url"
                  type="url"
                  value={baseUrl}
                  disabled={isSaving || isClearing}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.openai.com/v1 - or e.g. MiniMax https://api.minimax.io/v1"
                />
                <p className="text-xs text-muted-foreground">
                  Point at any OpenAI-compatible provider (OpenAI, MiniMax, Together, Groq, local
                  vLLM, ...). Leave blank to use OpenAI.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="settings-model">Model name</Label>
                <Input
                  id="settings-model"
                  value={model}
                  disabled={isSaving || isClearing}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="gpt-4o-mini, abab6.5s-chat, ..."
                />
              </div>
            </div>
          </div>
        )}

        <DialogFooter showCloseButton>
          {account?.hasOwnKey && (
            <Button
              type="button"
              variant="outline"
              onClick={handleClear}
              disabled={isSaving || isClearing}
              className="gap-2"
            >
              {isClearing && <Loader2 className="size-3.5 animate-spin" />}
              Remove my key / use free tier
            </Button>
          )}
          <Button onClick={handleSave} disabled={isSaving || isClearing || isLoading} className="gap-2">
            {isSaving && <Loader2 className="size-3.5 animate-spin" />}
            Save key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
