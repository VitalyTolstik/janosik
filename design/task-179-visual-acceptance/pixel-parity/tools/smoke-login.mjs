const response = await fetch("http://127.0.0.1:5302/api/v1/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    email: "pixel-admin@example.com",
    password: "pixel-demo-password",
  }),
});
console.log(response.status, await response.text());
