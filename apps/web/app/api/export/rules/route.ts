import { exporter } from "@brain/core";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";
import { getActiveProject } from "@/lib/brain/active-project";
import type { DataScope } from "@brain/core";

const FORMATS = ["bundle", "manifest", "claude", "cursor", "windsurf", "agents"] as const;
type FormatParam = (typeof FORMATS)[number];

function isFormat(s: string): s is FormatParam {
  return (FORMATS as readonly string[]).includes(s);
}

export async function GET(req: Request): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const url = new URL(req.url);
    const formatRaw = url.searchParams.get("format") ?? "bundle";
    const format: FormatParam = isFormat(formatRaw) ? formatRaw : "bundle";
    const dataScope: DataScope =
      url.searchParams.get("scope") === "all" ? "all" : "project";

    const { projectId } = await getActiveProject(userId);
    const bundle = await exporter.buildRulesBundle(userId, projectId, dataScope);

    if (format === "bundle") {
      return Response.json(bundle);
    }
    if (format === "manifest") {
      return new Response(exporter.renderManifest(bundle), {
        headers: { "content-type": "text/markdown; charset=utf-8" },
      });
    }
    const match = bundle.files.find((f) => f.format === format);
    if (!match) {
      return Response.json(
        { error: "no_rules_for_format", format },
        { status: 404 },
      );
    }
    return new Response(match.content, {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${match.path
          .split("/")
          .pop()}"`,
      },
    });
  } catch (err) {
    return authErrorResponse(err);
  }
}
