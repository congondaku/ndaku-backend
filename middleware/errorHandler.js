const errorHandler = (err, req, res, next) => {
  console.error(err.stack); // Log the error stack

  // Check if it's a Mongoose ValidationError
  if (err.name === "ValidationError") {
    return res
      .status(400)
      .json({ error: "Validation Error", message: err.message });
  }

  // Check if it's a Mongoose CastError
  if (err.name === "CastError") {
    return res
      .status(400)
      .json({ error: "Invalid ID Format", message: err.message });
  }

  // Generic error response
  return res.status(500).json({
    error: "Internal Server Error",
    message: err.message || "Something went wrong",
  });
};

module.exports = { errorHandler };
