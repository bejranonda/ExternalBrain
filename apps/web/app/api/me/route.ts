import { db } from "@brain/db";
import { envForWeb } from "@brain/core";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";

export async function GET(): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        teams: {
          select: {
            role: true,
            team: { select: { id: true, name: true } },
          },
        },
        credential: { select: { id: true } },
      },
    });
    if (!user) return Response.json({ user: null });
    return Response.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        hasCredential: user.credential !== null,
        teams: user.teams.map((tm) => ({
          id: tm.team.id,
          name: tm.team.name,
          role: tm.role,
        })),
      },
      capabilities: {
        meetingUploadEnabled: envForWeb().MEETING_UPLOAD_ENABLED,
      },
    });
  } catch (err) {
    return authErrorResponse(err);
  }
}
