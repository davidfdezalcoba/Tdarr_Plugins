import {
  getFileSize,
  getContainer,
  getFileAbosluteDir,
  getFileName,
} from '../../../../FlowHelpers/1.0.0/fileUtils';
import {
  IpluginDetails,
  IpluginInputArgs,
  IpluginOutputArgs,
} from '../../../../FlowHelpers/1.0.0/interfaces/interfaces';

const details = (): IpluginDetails => ({
  name: 'Notify and Rename Radarr or Sonarr',
  description:
    'Notify Radarr or Sonarr and apply the naming policy to a file.'
    + 'This plugin calls the Rename api in the arr application, so no further notification is needed',
  style: {
    borderColor: 'green',
  },
  tags: '',
  isStartPlugin: false,
  pType: '',
  requiresVersion: '2.11.01',
  sidebarPosition: -1,
  icon: 'faPenToSquare',
  inputs: [
    {
      label: 'Arr',
      name: 'arr',
      type: 'string',
      defaultValue: '{{{args.userVariables.library.arr}}}',
      inputUI: {
        type: 'text',
      },
      tooltip: 'Specify which arr to use',
    },
    {
      label: 'Arr API Key',
      name: 'arr_api_key',
      type: 'string',
      defaultValue: '{{{args.userVariables.library.api}}}',
      inputUI: {
        type: 'text',
      },
      tooltip: 'Input your arr api key here',
    },
    {
      label: 'Arr Host',
      name: 'arr_host',
      type: 'string',
      defaultValue: '{{{args.userVariables.library.host}}}',
      inputUI: {
        type: 'text',
      },
      tooltip: 'Input your arr host here.'
        + '\\nExample:\\n'
        + 'http://192.168.1.1:7878\\n'
        + 'http://192.168.1.1:8989\\n'
        + 'https://radarr.domain.com\\n'
        + 'https://sonarr.domain.com\\n',
    },
    {
      label: 'Startup delay',
      name: 'startup_delay',
      type: 'number',
      defaultValue: '{{{args.userVariables.library.delay}}}',
      inputUI: {
        type: 'text',
      },
      tooltip: 'Specify the startup delay in seconds. This waits for sonarr/radarr to pick up any notify changes.',
    },
  ],
  outputs: [
    {
      number: 1,
      tooltip: 'Radarr or Sonarr notified',
    },
    {
      number: 2,
      tooltip: 'Radarr or Sonarr do not know this file',
    },
  ],
});

interface IHTTPHeaders {
  'Content-Type': string,
  'X-Api-Key': string,
  Accept: string,
}
interface IFileInfo {
  id: string,
  seasonNumber?: number,
  episodeNumber?: number
}
interface ILookupResponse {
  data: [{ id: number }],
}
interface IParseResponse {
  data: {
    movie?: { id: number },
    series?: { id: number },
    parsedEpisodeInfo?: {
      episodeNumbers: number[],
      seasonNumber: number
    },
  },
}
interface IFileToRename {
  newPath: string,
  movieId?: number,
  movieFileId?: number,
  seriesId?: number,
  episodeFileId?: number,
  episodeNumbers?: number[]
}
interface IRenameDataToSend {
  movieId?: number,
  seriesId?: number,
  files: number[],
  name: 'RenameFiles'
}
interface IPreviewRenameResponse {
  data: IFileToRename[]
}
interface IArrApp {
  name: string,
  host: string,
  headers: IHTTPHeaders,
  content: string,
  delegates: {
    getFileInfoFromLookupResponse:
    (lookupResponse: ILookupResponse, fileName: string) => IFileInfo,
    getFileInfoFromParseResponse:
    (parseResponse: IParseResponse) => IFileInfo,
    buildPreviewRenameResquestUrl:
    (fileInfo: IFileInfo) => string,
    getFileToRenameFromPreviewRenameResponse:
    (previewRenameResponse: IPreviewRenameResponse, fileInfo: IFileInfo) => IFileToRename | undefined,
    buildRenameDataFromPreviewRenameResponse:
    (fileToRename: IFileToRename) => IRenameDataToSend
    buildRefreshResquestData:
    (id: number) => string
  }
}

const getSizeBytes = async (fPath: string): Promise<number> => {
  let size = 0;
  try {
    size = await getFileSize(fPath);
  } catch (err) {
    // err
  }
  return size;
};

const compareOldNew = ({
  sourceFileSize,
  destinationSize,
  args,
}:{
    sourceFileSize:number,
    destinationSize:number,
    args:IpluginInputArgs,
  }):void => {
  if (destinationSize !== sourceFileSize) {
    args.jobLog(`After move/copy, destination file of size ${destinationSize} does not match`
      + ` cache file of size ${sourceFileSize}`);
  } else {
    args.jobLog(`After move/copy, destination file of size ${destinationSize} does match`
      + ` cache file of size ${sourceFileSize}`);
  }
};

const getFileInfoFromLookup = async (
  args: IpluginInputArgs,
  arrApp: IArrApp,
  fileName: string,
)
  : Promise<IFileInfo> => {
  let fInfo: IFileInfo = { id: '-1' };
  const imdbId = /\b(tt|nm|co|ev|ch|ni)\d{7,10}?\b/i.exec(fileName)?.at(0) ?? '';
  if (imdbId !== '') {
    const lookupResponse: ILookupResponse = await args.deps.axios({
      method: 'get',
      url: `${arrApp.host}/api/v3/${arrApp.name === 'radarr' ? 'movie' : 'series'}/lookup?term=imdb:${imdbId}`,
      headers: arrApp.headers,
    });
    fInfo = arrApp.delegates.getFileInfoFromLookupResponse(lookupResponse, fileName);
    args.jobLog(`${arrApp.content} ${fInfo.id !== '-1' ? `'${fInfo.id}' found` : 'not found'}`
      + ` for imdb '${imdbId}'`);
  }
  return fInfo;
};

const getFileInfoFromParse = async (
  args: IpluginInputArgs,
  arrApp: IArrApp,
  fileName: string,
)
  : Promise<IFileInfo> => {
  let fInfo: IFileInfo = { id: '-1' };
  const parseResponse: IParseResponse = await args.deps.axios({
    method: 'get',
    url: `${arrApp.host}/api/v3/parse?title=${encodeURIComponent(getFileName(fileName))}`,
    headers: arrApp.headers,
  });
  fInfo = arrApp.delegates.getFileInfoFromParseResponse(parseResponse);
  args.jobLog(`${arrApp.content} ${fInfo.id !== '-1' ? `'${fInfo.id}' found` : 'not found'}`
    + ` for '${getFileName(fileName)}'`);
  return fInfo;
};

const getFileInfo = async (
  args: IpluginInputArgs,
  arrApp: IArrApp,
  fileName: string,
)
  : Promise<IFileInfo> => {
  const fInfo = await getFileInfoFromLookup(args, arrApp, fileName);
  return (fInfo.id === '-1' || (arrApp.name === 'sonarr' && (fInfo.seasonNumber === -1 || fInfo.episodeNumber === -1)))
    ? getFileInfoFromParse(args, arrApp, fileName)
    : fInfo;
};

const plugin = async (args: IpluginInputArgs): Promise<IpluginOutputArgs> => {
  const lib = require('../../../../../methods/lib')();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars,no-param-reassign
  args.inputs = lib.loadDefaultValues(args.inputs, details);

  let newPath = '';
  let isSuccessful = false;
  const arr = String(args.inputs.arr).trim();
  const startup_delay = Number(args.inputs.startup_delay);
  const arr_host = String(args.inputs.arr_host).trim();
  const arrHost = arr_host.endsWith('/') ? arr_host.slice(0, -1) : arr_host;
  const originalFileName = args.originalLibraryFile?._id ?? '';
  const currentFileName = args.inputFileObj?._id ?? '';
  const headers = {
    'Content-Type': 'application/json',
    'X-Api-Key': String(args.inputs.arr_api_key),
    Accept: 'application/json',
  };

  const arrApp: IArrApp = arr === 'radarr'
    ? {
      name: arr,
      host: arrHost,
      headers,
      content: 'Movie',
      delegates: {
        getFileInfoFromLookupResponse:
          (lookupResponse) => ({ id: String(lookupResponse?.data?.at(0)?.id ?? -1) }),
        getFileInfoFromParseResponse:
          (parseResponse) => ({ id: String(parseResponse?.data?.movie?.id ?? -1) }),
        buildPreviewRenameResquestUrl:
          (fInfo) => `${arrHost}/api/v3/rename?movieId=${fInfo.id}`,
        getFileToRenameFromPreviewRenameResponse:
          (previewRenameResponse) => previewRenameResponse.data?.at(0),
        buildRenameDataFromPreviewRenameResponse:
          (fileToRename) => ({
            name: 'RenameFiles',
            movieId: fileToRename.movieId ?? -1,
            files: [fileToRename.movieFileId ?? -1],
          }),
        buildRefreshResquestData:
          (id) => JSON.stringify({ name: 'RefreshMovie', movieIds: [id] }),
      },
    }
    : {
      name: arr,
      host: arrHost,
      headers,
      content: 'Serie',
      delegates: {
        getFileInfoFromLookupResponse:
          (lookupResponse, fileName) => {
            const fInfo: IFileInfo = { id: String(lookupResponse?.data?.at(0)?.id ?? -1) };
            if (fInfo.id !== '-1') {
              const seasonEpisodenumber = /\bS\d{1,3}E\d{1,4}\b/i.exec(fileName)?.at(0) ?? '';
              const episodeNumber = /\d{1,4}$/i.exec(seasonEpisodenumber)?.at(0) ?? '';
              fInfo.seasonNumber = Number(/\d{1,3}/i
                .exec(seasonEpisodenumber.slice(0, -episodeNumber.length))
                ?.at(0) ?? '-1');
              fInfo.episodeNumber = Number(episodeNumber !== '' ? episodeNumber : -1);
            }
            return fInfo;
          },
        getFileInfoFromParseResponse:
          (parseResponse) => ({
            id: String(parseResponse?.data?.series?.id ?? -1),
            seasonNumber: parseResponse?.data?.parsedEpisodeInfo?.seasonNumber ?? 1,
            episodeNumber: parseResponse?.data?.parsedEpisodeInfo?.episodeNumbers?.at(0) ?? 1,
          }),
        buildPreviewRenameResquestUrl:
          (fInfo) => `${arrHost}/api/v3/rename?seriesId=${fInfo.id}&seasonNumber=${fInfo.seasonNumber}`,
        getFileToRenameFromPreviewRenameResponse:
          (previewRenameResponse, fInfo) => previewRenameResponse.data
            ?.find((episodeFile) => episodeFile.episodeNumbers?.at(0) === fInfo.episodeNumber),
        buildRenameDataFromPreviewRenameResponse:
          (fileToRename) => ({
            name: 'RenameFiles',
            seriesId: fileToRename.seriesId ?? -1,
            files: [fileToRename.episodeFileId ?? -1],
          }),
        buildRefreshResquestData:
          (id) => JSON.stringify({ name: 'RefreshSeries', seriesId: id }),
      },
    };

  args.jobLog('Going to apply new name');
  args.jobLog(`Refreshing and renaming ${arrApp.name}...`);

  // Retrieving movie or serie id, plus season and episode number for serie
  let fInfo = await getFileInfo(args, arrApp, originalFileName);
  // Useful in some edge cases
  if (fInfo.id === '-1' && currentFileName !== originalFileName) {
    fInfo = await getFileInfo(args, arrApp, currentFileName);
  }

  // Checking that the file has been found
  if (fInfo.id !== '-1') {
    try {
      await args.deps.axios({
        method: 'post',
        url: `${arrApp.host}/api/v3/command`,
        headers,
        data: arrApp.delegates.buildRefreshResquestData(Number(fInfo.id)),
      });
      args.jobLog(`✔ ${arrApp.content} '${fInfo.id}' refreshed in ${arrApp.name}.`);
      args.jobLog(`Waiting for ${startup_delay} seconds for the refresh to pick up.`);
      await new Promise((f) => setTimeout(f, startup_delay * 1000));
    } catch (error) {
      args.jobLog(`Could not refresh ${arrApp.content} '${fInfo.id}' in ${arrApp.name}.`);
      args.jobLog(JSON.stringify(error));
    }

    // Using rename endpoint to get ids of all the files that need renaming
    const previewRenameRequestResult = await args.deps.axios({
      method: 'get',
      url: arrApp.delegates.buildPreviewRenameResquestUrl(fInfo),
      headers,
    });
    const fileToRename = arrApp.delegates
      .getFileToRenameFromPreviewRenameResponse(previewRenameRequestResult, fInfo);

    // Only if there is a rename to execute
    if (fileToRename !== undefined) {
      newPath = `${getFileAbosluteDir(currentFileName)}/${
        getFileName(fileToRename.newPath)}.${
        getContainer(fileToRename.newPath)}`;

      args.jobLog(`New path is ${newPath}`);
      args.jobLog('Calculating cache file size in bytes');
      const sourceFileSize = await getSizeBytes(currentFileName);
      args.jobLog(`${sourceFileSize}`);
      args.jobLog(JSON.stringify(fileToRename));
      args.jobLog(JSON.stringify(arrApp.delegates.buildRenameDataFromPreviewRenameResponse(fileToRename)));

      isSuccessful = true;

      try {
        await args.deps.axios({
          method: 'post',
          url: `${arrApp.host}/api/v3/command`,
          headers,
          data: arrApp.delegates.buildRenameDataFromPreviewRenameResponse(fileToRename),
        });
        await new Promise((f) => setTimeout(f, 5000));
      } catch (error) {
        isSuccessful = false;
        args.jobLog(JSON.stringify(error));
      }

      const destinationSize = await getSizeBytes(newPath);
      compareOldNew({
        sourceFileSize,
        destinationSize,
        args,
      });
    } else {
      isSuccessful = true;
      args.jobLog('✔ No rename necessary.');
    }
  }

  return {
    outputFileObj:
      isSuccessful && newPath !== ''
        ? { ...args.inputFileObj, _id: newPath }
        : args.inputFileObj,
    outputNumber: isSuccessful ? 1 : 2,
    variables: args.variables,
  };
};

export {
  details,
  plugin,
};
