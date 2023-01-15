import { OAuth2Client } from "google-auth-library";
import userService from "../services/UserService";
import { UserId } from "../types/user";

export type AuthenticatedRequest = Request & { userId: UserId };

export default (req, res, next) => {
  const googleClientId =
    "344303216827-jtutvdqjp24q0or2fpqf5mihja138sem.apps.googleusercontent.com";
  const client = new OAuth2Client(googleClientId);
  client
    .verifyIdToken({
      idToken: req.cookies.auth,
      //audience: googleClientId
    })
    .then((verification) => {
      const payload = verification.getPayload();

      let user = payload && userService.authenticate("google", payload.sub);

      if (user) {
        (req as AuthenticatedRequest).userId = user.getId();
      } else {
        if (payload) {
          user = userService.create(
            payload.name,
            payload.picture,
            payload.email
          );
          user.addAuth({
            source: "google",
            id: payload.sub,
          });
          (req as AuthenticatedRequest).userId = user.getId();
          console.log(user);
        } else {
          res.status(401);
          res.send("Access forbidden");
        }
      }

      next();
    })
    .catch((e) => {
      res.status(401);
      res.send("Access forbidden");
    });
};
