export const errorHandler = (error, _req, res, _next) => {
  const status = error.status || 500;

  res.status(status).json({
    ok: false,
    error: {
      message: error.message || "Internal server error",
    },
  });
};

