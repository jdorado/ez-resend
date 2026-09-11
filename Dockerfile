FROM node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94 AS runtime
WORKDIR /app
COPY package.json ez-plugin.json ez-deployment.json README.md SECURITY.md CONTRIBUTING.md CHANGELOG.md LICENSE ./
COPY bin ./bin
COPY src ./src
COPY skills ./skills
RUN mkdir /state && chown -R node:node /app /state
USER node
CMD ["node", "-e", "setInterval(() => {}, 3600000)"]
