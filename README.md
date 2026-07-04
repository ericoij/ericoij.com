# Minecraft_world

A Paper Minecraft server setup for local Windows hosting or Docker-based VPS
deployment. It includes:

- Paper server setup
- Chunky chunk pre-generation
- Geyser + Floodgate for Bedrock/Nintendo Switch support
- Docker Compose config for deployment

## Local Windows Hosting

Requirements:

- Java 21+ or the portable Java installed by the setup scripts
- Router/firewall access if other devices need to connect

Start the server:

```powershell
cd C:\Users\erico\src\Codex_Try\minecraft-server
powershell -ExecutionPolicy Bypass -File .\start-local.ps1
```

Java players connect to:

```text
192.168.1.192:25565
```

Bedrock/Switch players connect through Geyser on:

```text
192.168.1.192
Port: 19132
```

Nintendo Switch usually needs a BedrockConnect DNS method because Switch does
not expose custom server entry in the normal server list.

## Chunk Pre-Generation

After the server is running, type in the server console:

```text
chunky radius 5000
chunky start
```

Useful controls:

```text
chunky progress
chunky pause
chunky continue
chunky cancel
```

Use a smaller radius first if you are testing. Large radii can take a while and
increase world folder size.

## VPS / Docker Deploy

On the server:

```bash
git clone https://github.com/ericoij/Minecraft_world.git
cd Minecraft_world/minecraft-server
cp .env.example .env
```

Edit `.env`:

```env
MINECRAFT_EULA=TRUE
RCON_PASSWORD=<strong-password>
```

Start it:

```bash
docker compose up -d
```

Open these firewall ports:

```text
TCP 25565    Java Edition
UDP 19132    Bedrock/Geyser
```

Watch logs:

```bash
docker compose logs -f minecraft
```

Run admin commands:

```bash
docker compose exec minecraft rcon-cli list
docker compose exec minecraft rcon-cli op YourMinecraftName
```

World data is stored in the Docker named volume:

```text
minecraft-data
```

Back it up before changing server versions or server types.

## Notes

- Runtime databases, Minecraft worlds, logs, downloaded server jars, plugins,
  and secrets are intentionally ignored by git.
- Keep `.env` files private.
- Back up Minecraft world data before major updates.
