# Specific infrastructure for AI Engineer Master Lab.
#
# The app is a fully static Vite + React SPA: Python (Pyodide), SQL (sql.js) and
# the PDF reader all run inside the browser, so there is no backend and no
# database. The whole stack is therefore one build plus one static web service.
#
#   specific dev      -> runs the Vite dev server with hot reload
#   specific deploy   -> builds the bundle and serves dist/ from a public HTTPS endpoint

build "web" {
  base    = "node"
  command = "npm run build"
}

service "web" {
  build   = build.web
  command = "npx -y serve -s dist -l $PORT"

  endpoint {
    public = true
    health_check {
      path = "/"
    }
  }

  env = {
    PORT = port
  }

  # Local development: Vite's own dev server. `--host` is needed so the Specific
  # proxy can reach it (Vite binds loopback only by default), `--port` binds it to
  # the port Specific assigned to this endpoint.
  dev {
    command = "npm run dev -- --port $PORT --host"
  }
}
