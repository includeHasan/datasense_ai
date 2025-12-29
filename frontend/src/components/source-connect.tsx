"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { UploadIcon } from "lucide-react";

import * as api from "@/lib/api";
import { ApiError } from "@/lib/api";
import type { SchemaProfile } from "@/lib/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { cn } from "@/lib/utils";

const ACCEPTED_EXTENSIONS = [".csv", ".json", ".xlsx", ".xls"];

const dbSchema = z.object({
  kind: z.enum(["postgres", "mysql", "sqlite", "mongodb"]),
  connectionString: z.string().min(1, "Connection string is required"),
});

type DbValues = z.infer<typeof dbSchema>;

const CONNECTION_STRING_PLACEHOLDERS: Record<DbValues["kind"], string> = {
  postgres: "postgres://user:password@host:5432/db",
  mysql: "mysql://user:password@host:3306/db",
  sqlite: "/path/to/database.sqlite",
  mongodb: "mongodb://user:password@host:27017/db",
};

interface SourceConnectProps {
  token: string;
  onConnected: (sourceId: string, profile: SchemaProfile) => void;
}

function UploadFileTab({ token, onConnected }: SourceConnectProps) {
  const [file, setFile] = React.useState<File | null>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const [isUploading, setIsUploading] = React.useState(false);

  function hasAcceptedExtension(candidate: File) {
    const name = candidate.name.toLowerCase();
    return ACCEPTED_EXTENSIONS.some((extension) => name.endsWith(extension));
  }

  function handleFiles(fileList: FileList | null) {
    const selected = fileList?.[0];
    if (!selected) return;
    if (!hasAcceptedExtension(selected)) {
      toast.error("Unsupported file type. Use .csv, .json, .xlsx, or .xls.");
      return;
    }
    setFile(selected);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setIsUploading(true);
    try {
      const result = await api.uploadFile(token, file);
      onConnected(result.sourceId, result.profile);
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : "Failed to upload file.";
      toast.error(message);
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <label
        htmlFor="source-file-input"
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          handleFiles(event.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-none border border-dashed border-border p-8 text-center text-sm text-muted-foreground transition-colors",
          isDragging && "border-primary bg-greenbar"
        )}
      >
        <UploadIcon className="size-6" />
        {file ? (
          <span className="font-mono font-medium text-foreground">{file.name}</span>
        ) : (
          <span>Drop a file here, or click to browse</span>
        )}
        <span className="font-mono text-xs">Accepts .csv, .json, .xlsx, .xls</span>
        <input
          id="source-file-input"
          type="file"
          accept=".csv,.json,.xlsx,.xls"
          className="hidden"
          onChange={(event) => handleFiles(event.target.files)}
        />
      </label>

      {isUploading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-full" />
        </div>
      ) : (
        <Button type="submit" disabled={!file} className="w-fit">
          Upload
        </Button>
      )}
    </form>
  );
}

function ConnectDbTab({ token, onConnected }: SourceConnectProps) {
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const form = useForm<DbValues>({
    resolver: zodResolver(dbSchema),
    defaultValues: { kind: "postgres", connectionString: "" },
  });
  const selectedKind = form.watch("kind");

  async function onSubmit(values: DbValues) {
    setIsSubmitting(true);
    try {
      const result = await api.connectDb(
        token,
        values.kind,
        values.connectionString
      );
      onConnected(result.sourceId, result.profile);
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : "Failed to connect database.";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-4"
      >
        <FormField
          control={form.control}
          name="kind"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Database kind</FormLabel>
              <FormControl>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a database kind" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="postgres">Postgres</SelectItem>
                    <SelectItem value="mysql">MySQL</SelectItem>
                    <SelectItem value="sqlite">SQLite</SelectItem>
                    <SelectItem value="mongodb">MongoDB</SelectItem>
                  </SelectContent>
                </Select>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="connectionString"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Connection string</FormLabel>
              <FormControl>
                <Input
                  placeholder={CONNECTION_STRING_PLACEHOLDERS[selectedKind]}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" disabled={isSubmitting} className="w-fit">
          {isSubmitting ? "Connecting…" : "Connect"}
        </Button>
      </form>
    </Form>
  );
}

export function SourceConnect({ token, onConnected }: SourceConnectProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect a data source</CardTitle>
        <CardDescription>
          Upload a file or connect a database. We&apos;ll profile the schema so you can start asking questions.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="upload">
          <TabsList>
            <TabsTrigger value="upload">Upload file</TabsTrigger>
            <TabsTrigger value="database">Connect database</TabsTrigger>
          </TabsList>
          <TabsContent value="upload" className="pt-4">
            <UploadFileTab token={token} onConnected={onConnected} />
          </TabsContent>
          <TabsContent value="database" className="pt-4">
            <ConnectDbTab token={token} onConnected={onConnected} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
