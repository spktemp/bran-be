import { Router } from "express";

import { facebookRouter } from "../../../modules/instagram/facebook.routes";
import { instagramRouter } from "../../../modules/instagram/instagram.routes";
import { linkedinRouter } from "../../../modules/instagram/linkedin.routes";
import { youtubeRouter } from "../../../modules/instagram/youtube.routes";
import { healthRouter } from "./health.routes";

import { authRouter } from "../../../modules/auth/auth.routes";
import { usersRouter } from "../../../modules/users/users.routes";
import { rolesRouter } from "../../../modules/roles/roles.routes";
import { tasksRouter } from "../../../modules/tasks/tasks.routes";
import { aiRouter } from "../../../modules/ai/ai.routes";
import { socialApiRouter } from "../../../modules/social-api/social-api.routes";
import { teamsRouter } from "../../../modules/teams/teams.routes";
import { projectsRouter } from "../../../modules/projects/projects.routes";
import { verticalsRouter } from "../../../modules/verticals/verticals.routes";
import { contentRouter } from "../../../modules/content/content.routes";
import { notificationsRouter } from "../../../modules/notifications/notifications.routes";
import { ideationRouter } from "../../../modules/ideation/ideation.routes";
import { adhocWorkRouter } from "../../../modules/adhoc-work/adhoc-work.routes";
import { workRouter } from "../../../modules/work/work.routes";

const v1Router = Router();

v1Router.use("/health", healthRouter);

// Auth (public -- no auth middleware)
v1Router.use("/auth", authRouter);

// Protected modules
v1Router.use("/users", usersRouter);
v1Router.use("/roles", rolesRouter);
v1Router.use("/tasks", tasksRouter);
v1Router.use("/ai", aiRouter);
v1Router.use("/social-api", socialApiRouter);
v1Router.use("/verticals", verticalsRouter);
v1Router.use("/teams", teamsRouter);
v1Router.use("/projects", projectsRouter);
v1Router.use("/contents", contentRouter);
v1Router.use("/notifications", notificationsRouter);
v1Router.use("/ideation", ideationRouter);
v1Router.use("/adhoc-work", adhocWorkRouter);
v1Router.use("/work", workRouter);

// Existing Meltwater-based routes
v1Router.use("/instagram", instagramRouter);
v1Router.use("/linkedin", linkedinRouter);
v1Router.use("/youtube", youtubeRouter);
v1Router.use("/facebook", facebookRouter);

export { v1Router };
