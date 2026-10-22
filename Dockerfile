FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS runtime
WORKDIR /app
COPY package.json ez-plugin.json ez-deployment.json README.md SECURITY.md CONTRIBUTING.md CHANGELOG.md LICENSE ./
COPY bin ./bin
COPY src ./src
COPY skills ./skills
RUN mkdir /state && chown -R node:node /app /state
USER node
CMD ["node", "/app/src/cli.mjs", "serve"]
