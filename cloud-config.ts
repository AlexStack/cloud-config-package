import AES from "crypto-js/aes";
import encUtf8 from "crypto-js/enc-utf8";

export interface CloudConfigData {
  projectName: string;
  groupName: string;
  featureKey: string;
  value: unknown;
  valueType: string;
  prodEnabled?: boolean;
  devEnabled?: boolean;
  valueEncrypted?: boolean;
}

export const CLOUD_CONFIG_DEFAULT_GROUP = "defaultGroup";
export const CLOUD_CONFIG_DEFAULT_PROJECT = "defaultProject";

export const IS_PROD = process.env.NODE_ENV === "production";

export const CLOUD_CONFIG_API_ENDPOINT =
  process.env.NEXT_PUBLIC_CLOUD_CONFIG_API_ENDPOINT ||
  "http://localhost:3001/api";

export const CLOUD_CONFIG_ORG_ID =
  process.env.NEXT_PUBLIC_CLOUD_CONFIG_ORG_ID ||
  "Missing NEXT_PUBLIC_CLOUD_CONFIG_ORG_ID in .env";

const couldConfigSecretClient =
  process.env.NEXT_PUBLIC_CLOUD_CONFIG_CLIENT_ENCRYPT_SECRET;

const couldConfigSecretServer = process.env.CLOUD_CONFIG_SERVER_ENCRYPT_SECRET;

export const decryptData = (
  data: string,
  cryptSecret: string
): string | null => {
  const decryptedText = AES.decrypt(data, cryptSecret);
  if (!decryptedText) {
    return null;
  }
  return decryptedText.toString(encUtf8);
};

export const parseSingleConfig = (
  config: CloudConfigData,
  serverSideOnly = false
): CloudConfigData => {
  if (!config.valueEncrypted) {
    return config;
  }
  const cryptSecret = serverSideOnly
    ? couldConfigSecretServer
    : couldConfigSecretClient;
  if (!cryptSecret) {
    // eslint-disable-next-line no-console
    console.log(
      `Can't decrypt featureKey ${config.featureKey}, Please set ${
        serverSideOnly
          ? "CLOUD_CONFIG_SERVER_ENCRYPT_SECRET"
          : "NEXT_PUBLIC_CLOUD_CONFIG_CLIENT_ENCRYPT_SECRET"
      } in .env`
    );
    return config;
  }
  const decryptedValue = decryptData(config.value as string, cryptSecret);
  if (!decryptedValue) {
    return config;
  }

  let newValue;
  if (config.valueType === "json") {
    try {
      newValue = JSON.parse(decryptedValue);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.log("JSON.parse(decryptedValue) error", config.value, error);
    }
  }
  if (config.valueType === "array") {
    newValue = decryptedValue.split(",").map((tag) => tag.trim());
  }
  if (config.valueType === "number") {
    newValue = parseFloat(decryptedValue);
  }
  if (config.valueType === "boolean") {
    newValue = Boolean(decryptedValue);
  }

  const newConfig = {
    ...config,
    value: newValue || decryptedValue,
  };

  return newConfig;
};

export const parseAllConfigs = (
  configs: CloudConfigData[],
  serverSideOnly = false
): CloudConfigData[] => {
  return configs.map((config) => parseSingleConfig(config, serverSideOnly));
};

interface GetCloudConfigParams {
  featureKey: string;
  groupName?: string;
  projectName?: string;
  configs: CloudConfigData[];
}

export const getCloudConfig = <T>({
  featureKey,
  groupName = CLOUD_CONFIG_DEFAULT_GROUP,
  projectName = CLOUD_CONFIG_DEFAULT_PROJECT,
  configs,
}: GetCloudConfigParams) => {
  const config = configs.find((item) => {
    if (item.featureKey !== featureKey) {
      return false;
    }
    if (item.groupName !== groupName) {
      return false;
    }
    if (item.projectName !== projectName) {
      return false;
    }
    return true;
  });
  if (!config) {
    return null;
  }
  if (IS_PROD && !config.prodEnabled) {
    return null;
  }
  if (!IS_PROD && !config.devEnabled) {
    return null;
  }

  return config.value as T;
};

export const fetchAllConfigs = async ({
  orgId = CLOUD_CONFIG_ORG_ID,
  serverSide = false,
  accessToken,
  cache = "default",
  apiPrefix = CLOUD_CONFIG_API_ENDPOINT,
}: {
  orgId?: string;
  serverSide?: boolean;
  accessToken?: string;
  cache?: RequestCache;
  apiPrefix?: string;
}) => {
  try {
    const startTime = Date.now();

    const apiEndpoint = serverSide
      ? `${apiPrefix}/server-config`
      : `${apiPrefix}/client-config?orgId=${orgId}`;

    const requestData = serverSide
      ? JSON.stringify({ orgId, accessToken })
      : undefined;
    const response = await fetch(apiEndpoint, {
      method: serverSide ? "POST" : "GET",
      body: requestData,
      headers: {
        "Content-Type": "application/json",
      },
      cache: cache,
    });
    if (!response.ok) {
      console.log("🚀 Debug fetchAllConfigs requestData:", requestData);

      throw new Error(
        `😢 fetchAllConfigs failed: ${response.status}/${response.statusText} - ${apiEndpoint}`
      );
    }
    const duration = Date.now() - startTime;

    console.log(
      `fetchAllConfigs in ${(duration / 1000).toFixed(2)} seconds ${
        duration > 2000 ? "💔" : "-"
      } ${apiEndpoint}`
    );

    const configs = ((await response.json()) || []) as CloudConfigData[];

    return parseAllConfigs(configs, serverSide);
  } catch (error) {
    console.log("💔💔💔 fetchAllConfigs error:", error);
  }

  return [];
};

export default {
  CLOUD_CONFIG_DEFAULT_GROUP,
  CLOUD_CONFIG_DEFAULT_PROJECT,
  IS_PROD,
  CLOUD_CONFIG_API_ENDPOINT,
  decryptData,
  parseSingleConfig,
  parseAllConfigs,
  getCloudConfig,
  fetchAllConfigs,
};
