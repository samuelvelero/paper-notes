# PocketBase v0.39.6 (fijado a propósito, igual que tareas: se actualiza solo
# cuando tú decidas).
FROM alpine:3.20

ARG PB_VERSION=0.39.6

RUN apk add --no-cache ca-certificates unzip wget \
 && wget -q "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip" -O /tmp/pb.zip \
 && unzip -q /tmp/pb.zip -d /pb \
 && rm /tmp/pb.zip \
 && apk del unzip wget

WORKDIR /pb

# Al arrancar: crea/actualiza el superusuario con las credenciales del .env,
# aplica las migraciones de pb_migrations y sirve API + PWA en el 8090.
CMD ./pocketbase superuser upsert "$PB_ADMIN_EMAIL" "$PB_ADMIN_PASSWORD" --dir /pb/pb_data \
 && exec ./pocketbase serve --http=0.0.0.0:8090 --dir /pb/pb_data --publicDir /pb/pb_public \
      --hooksDir /pb/pb_hooks --migrationsDir /pb/pb_migrations

EXPOSE 8090
