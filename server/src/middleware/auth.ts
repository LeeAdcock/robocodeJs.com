import { OAuth2Client } from "google-auth-library";
import userService from "../services/UserService";
import authService from "../services/IdentityService";
import User from "../types/user";

export type AuthenticatedRequest = Request & { user: User };

export default (required: boolean) => async (req, res, next) => {
  const googleClientId =
    "344303216827-jtutvdqjp24q0or2fpqf5mihja138sem.apps.googleusercontent.com";
  const client = new OAuth2Client(googleClientId);
  try {
    return client
      .verifyIdToken({
        idToken: req.cookies.auth,
        //audience: googleClientId
      })
      .then((verification) => {
        const payload = verification.getPayload();

        if (payload) {
          return authService.get("google", payload.sub).then((userAuth) => {
            if (userAuth) {
              // We recognize this user
              return userService.get(userAuth.getUserId()).then((user) => {
                if (!user) {
                  // Should not be possbile to recognize their auth but not have
                  // a user record for them.
                  throw new Error("Missing account.");
                }
                (req as AuthenticatedRequest).user = user;
                return next();
              });
            } else {
              // Create this user
              return userService
                .create(payload.name, payload.picture, payload.email)
                .then((user) => {
                  (req as AuthenticatedRequest).user = user;
                  return authService
                    .create(user.getId(), "google", payload.sub)
                    .then(next);
                });
            }
          });
        }
      })
      .catch((e) => {
        if (required) {
          //console.log(e);
          res.clearCookie("auth");
          res.status(401);
          res.send("Access forbidden");
        } else {
          next();
        }
      });
  } catch (e) {
    res.clearCookie("auth");
    res.status(401);
    res.send("Access forbidden");
  }
};
