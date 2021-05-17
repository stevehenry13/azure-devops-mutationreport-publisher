import * as React from "react";
import * as ReactDOM from "react-dom";

import IframeResizer from 'iframe-resizer-react'
import IframeResizerContent from "!!raw-loader!iframe-resizer/js/iframeResizer.contentWindow.js";

import * as SDK from "azure-devops-extension-sdk";
import { CommonServiceIds, IProjectPageService, getClient, IProjectInfo } from "azure-devops-extension-api";
import { IBuildPageDataService, BuildServiceIds, IBuildPageData } from "azure-devops-extension-api/Build";
import { BuildRestClient } from "azure-devops-extension-api/Build/BuildClient"
import { BuildReference, Attachment } from "azure-devops-extension-api/Build/Build";

export interface IBuildResultTabData {
    reports: IReport[] | null;
    selectedIndex: number;
    loadSuccess: boolean;
}

export interface IReport {
    reportText: string | null,
    name: string
}

export class BuildResultTab extends React.Component<{}, IBuildResultTabData>
{
    reportType: string = "stryker-mutator.mutation-report";
    
    constructor(props: {}) {
        super(props);
        this.state = {
            reports: null,
            loadSuccess: false,
            selectedIndex : 0
        };
    }

   public renderReportList(): JSX.Element{

    if(this.state.reports?.length && this.state.reports.length > 1){
        var items = [];
        for (let i = 0; i < this.state.reports.length; i++) {
            const element = this.state.reports[i];
            let className = '';
            if (this.state.selectedIndex == i) {
                className = 'active';
            }
            items.push(<li className={className} onClick={() => {
                this.setState(
                    {
                        selectedIndex: i
                    }
                );
            }}>{element.name}</li>) ;
        }
        return(
            <ul>
            {items}
            </ul>
        );
    }
   
    return(
        <div></div>
      );
   }

    public render(): JSX.Element {

        console.trace("Current rendering state is {0}", this.state);
        if (this.state.reports?.length) {

            const _reportList = this.renderReportList();
            let augmentedReportText = this.augmentReportTextWithIframeResizerContent(this.state.reports[this.state.selectedIndex].reportText as string);
            return (
                <>
                    {_reportList}
                    <IframeResizer
                        src={this.getGeneratedPageURL(augmentedReportText)}
                        id="html-report-frame"
                        checkOrigin={false}
                        frameBorder="0"
                        style={{ width: '1px', minWidth: '100%', minHeight: '90vh'}}
                        scrolling={true}
                        marginHeight={0}
                        marginWidth={0}
                        resizeFrom="child"
                    />
                </>
            );
        }
        return (<p>Something went wrong..</p>);
    }

    public async componentDidMount() {
        SDK.init({ loaded: false });

        if(!this.state.reports) {
            await this.initializeState();
        }

        SDK.resize();
    }
    
    private async initializeState(): Promise<void> {
        await SDK.ready();
        
        const buildPageService: IBuildPageDataService = await SDK.getService(BuildServiceIds.BuildPageDataService);
        const buildPageData: IBuildPageData | undefined = await buildPageService.getBuildPageData();

        if (buildPageData?.build === undefined) {
            console.error("Error on getting build page data");
            return;
        }

        await this.extractReportHtml(buildPageData.build);
        
        SDK.resize();
        return;
    }

    private extractReportHtml = async (build: BuildReference): Promise<void> => {
        console.trace("Current build is {0}", build);
        
        const project = await this.getProject();

        if (build && project) {
            await this.getAttachmentsFromBuild(build, project);
        }
        else {
            console.error("Build or project not found..");
        }
        
        if (!this.state.loadSuccess) {
            console.error("No HTML report found..");
            SDK.notifyLoadFailed("No HTML report found..");
        }

        return;
    }

    private async getAttachmentsFromBuild(build: BuildReference, project: IProjectInfo): Promise<void> {
        console.trace("Build & Project found");

        const buildClient = getClient(BuildRestClient);
        const reportAttachments = await buildClient.getAttachments(project.id, build.id, this.reportType);

        if (reportAttachments.some(e => e)) {

            const _reports = [];

            for (let i = 0; i < reportAttachments.length; i++) {
                const attachmentMetadata = reportAttachments[i];

                if (attachmentMetadata._links?.self?.href) {
                    _reports.push({
                        reportText: await this.getAttachmentFromMetadataUrl(attachmentMetadata, buildClient, project, build),
                        name: attachmentMetadata.name
                    });
                }
                else {
                    console.error(`Attachment ${attachmentMetadata.name} file url not found..`);
                }
            }
            this.setState({
                reports: _reports.filter(_item => _item.reportText != null).map((_item) => { 
                    return {reportText : _item.reportText, name: _item.name};
                }),
                loadSuccess: true
            });
            SDK.notifyLoadSucceeded();
        }
        else {
            console.error("No Attachments found..");
        }
    }

    private async getAttachmentFromMetadataUrl(attachmentMetadata: Attachment, buildClient: BuildRestClient, project: IProjectInfo, build: BuildReference): Promise<string | null> {
        console.trace("Attachment {0} contains file url {1}", attachmentMetadata.name, attachmentMetadata._links.self.href);

        const reportUrl: string = attachmentMetadata._links.self.href;
        const timelineId = this.getArtifactTimelineId(reportUrl);
        const recordId = this.getArtifactRecordId(reportUrl);

        if (timelineId && recordId) {
            console.trace("Attachment timelineId {0} and recordId {1} found", timelineId, recordId);
            const attachment = await buildClient.getAttachment(project.id, build.id, timelineId, recordId, this.reportType, attachmentMetadata.name);
            const attachmentText = new TextDecoder('utf-8').decode(new Uint8Array(attachment));
            return attachmentText;
        }
        else {
            console.error("Attachment timelineId or recordId not found..");
            return null;
        }
    }

    private async getProject(): Promise<IProjectInfo> {

        const projectService = await SDK.getService<IProjectPageService>(CommonServiceIds.ProjectPageService);
        const project = await projectService.getProject();
        console.trace("Current Project is {0}", project);

        return project!;
    }

    private getGeneratedPageURL(html : string): string {
        const blob = new Blob([html], { type: "text/html" })

        return URL.createObjectURL(blob)
    }

    private augmentReportTextWithIframeResizerContent(reportText: string): string {
        let iframeResizerContentInsert = "<script>" + IframeResizerContent + "</script>";
        let existingScriptTagPosition = reportText.indexOf("<script>");
        let augmentedReportText = reportText.substring(0, existingScriptTagPosition) + iframeResizerContentInsert + reportText.substring(existingScriptTagPosition);

        console.log(augmentedReportText);
        return augmentedReportText;
    }

    private splitUrl(url: string): string[] | undefined {
        const startFromUrl = url.split("builds/")[1];
        if (startFromUrl.length > 0) {
            const urlParts = startFromUrl.split("/");

            if (urlParts.length > 0) {
                return urlParts;
            }
        }

        return undefined;
    }

    private getArtifactTimelineId(url: string): string | undefined {
        const urlParts = this.splitUrl(url);
        if (urlParts && urlParts.length > 1) {
            const timelineIdPart = urlParts[1];
            return timelineIdPart;
        }

        return undefined;
    }

    private getArtifactRecordId(url: string): string | undefined {
        const urlParts = this.splitUrl(url);
        if (urlParts && urlParts.length > 2) {
            const recordIdPart = urlParts[2];
            return recordIdPart;
        }

        return undefined;
    }
}

ReactDOM.render(<BuildResultTab />, document.getElementById("mutation-report-frame"));