import { BadRequestException, Injectable } from "@nestjs/common";
import {
  OAUTH_PROVIDER_IDS,
  type AdminOAuthProviderDto,
  type AdminUpdateOAuthProviderRequest,
  type OAuthProviderId,
} from "@janosik/shared";
import { PrismaService } from "@/common/prisma/prisma.service";
import { encryptSecret, decryptSecret } from "@/mailer/secret-box";
import { oauthCallbackUrl, OAUTH_PROVIDERS } from "./oauth.types";

/**
 * Master-panel storage for the OAuth provider credentials (TASK-54), the
 * exact analogue of EmailSettings: one row per provider (the row id IS the
 * provider id), the client secret AES-256-GCM encrypted at rest via
 * secret-box and never returned by any endpoint.
 */
@Injectable()
export class OAuthSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Decrypted credentials of an enabled provider, or `null`. */
  async credentials(
    provider: OAuthProviderId,
  ): Promise<{ clientId: string; clientSecret: string } | null> {
    const row = await this.prisma.oAuthProviderSettings.findUnique({
      where: { id: provider },
    });
    if (
      row === null ||
      !row.enabled ||
      row.clientSecretEnc === null ||
      row.clientId === ""
    ) {
      return null;
    }
    return {
      clientId: row.clientId,
      clientSecret: decryptSecret(row.clientSecretEnc),
    };
  }

  /** Both providers with their saved (masked) settings — admin panel view. */
  async listAdmin(): Promise<AdminOAuthProviderDto[]> {
    const rows = await this.prisma.oAuthProviderSettings.findMany();
    return OAUTH_PROVIDER_IDS.map((provider) => {
      const row = rows.find((candidate) => candidate.id === provider) ?? null;
      return {
        provider,
        clientId: row?.clientId ?? "",
        enabled: row?.enabled ?? false,
        hasSecret: row?.clientSecretEnc != null,
        callbackUrl: oauthCallbackUrl(provider),
        updatedBy: row?.updatedBy ?? null,
        updatedAt: row?.updatedAt.toISOString() ?? null,
      };
    });
  }

  /**
   * Upserts one provider's settings. `clientSecret` semantics mirror the
   * email settings password: `undefined` = keep the stored one, `null` =
   * clear it, a string = replace it.
   */
  async update(
    provider: OAuthProviderId,
    dto: AdminUpdateOAuthProviderRequest,
    updatedBy: string,
  ): Promise<AdminOAuthProviderDto> {
    if (!OAUTH_PROVIDER_IDS.includes(provider)) {
      throw new BadRequestException("Unknown OAuth provider");
    }
    const clientId = dto.clientId.trim();
    if (clientId === "") {
      throw new BadRequestException("Client ID is required");
    }
    const previous = await this.prisma.oAuthProviderSettings.findUnique({
      where: { id: provider },
    });
    let clientSecretEnc = previous?.clientSecretEnc ?? null;
    if (dto.clientSecret !== undefined) {
      clientSecretEnc =
        dto.clientSecret === null || dto.clientSecret === ""
          ? null
          : encryptSecret(dto.clientSecret);
    }
    if (dto.enabled && clientSecretEnc === null) {
      throw new BadRequestException(
        "Client secret is required to enable the provider",
      );
    }
    await this.prisma.oAuthProviderSettings.upsert({
      where: { id: provider },
      create: {
        id: provider,
        clientId,
        clientSecretEnc,
        enabled: dto.enabled,
        updatedBy,
      },
      update: {
        clientId,
        clientSecretEnc,
        enabled: dto.enabled,
        updatedBy,
      },
    });
    const all = await this.listAdmin();
    return all.find(
      (row) => row.provider === provider,
    ) as AdminOAuthProviderDto;
  }

  /** Labels for the login buttons of every enabled provider. */
  async listEnabled(): Promise<{ id: OAuthProviderId; label: string }[]> {
    const rows = await this.prisma.oAuthProviderSettings.findMany({
      where: { enabled: true },
    });
    return rows
      .filter((row) => row.clientSecretEnc !== null && row.clientId !== "")
      .map((row) => ({
        id: row.id as OAuthProviderId,
        label: OAUTH_PROVIDERS[row.id as OAuthProviderId].label,
      }))
      .sort(
        (a, b) =>
          OAUTH_PROVIDER_IDS.indexOf(a.id) - OAUTH_PROVIDER_IDS.indexOf(b.id),
      );
  }
}
