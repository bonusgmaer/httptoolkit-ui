import * as _ from 'lodash';
import * as React from 'react';
import { computed, observable, action, autorun, flow } from 'mobx';
import { observer, inject, disposeOnUnmount } from 'mobx-react';

import { styled } from '../../../styles';

import { Interceptor } from '../../../model/interception/interceptors';
import { ProxyStore } from '../../../model/proxy-store';
import { AccountStore } from '../../../model/account/account-store';
import { EventsStore } from '../../../model/events/events-store';
import { RulesStore } from '../../../model/rules/rules-store';
import { FridaActivationOptions, FridaHost, FridaTarget } from '../../../model/interception/frida';

import { getDetailedInterceptorMetadata } from '../../../services/server-api';

import { TextInput } from '../../common/inputs';
import { Icon } from '../../../icons';
import { InterceptionTargetList } from './intercept-target-list';
import { IconButton } from '../../common/icon-button';

const ConfigContainer = styled.div`
    user-select: text;

    height: 100%;
    max-height: 390px;
    display: flex;
    flex-direction: column;
    justify-content: start;

    margin: 5px -15px -15px -15px;
    width: calc(100% + 30px);

    > p {
        line-height: 1.2;

        &:not(:last-child) {
            margin-bottom: 5px;
        }

        &:not(:first-child) {
            margin-top: 5px;
        }
    }

    a[href] {
        color: ${p => p.theme.linkColor};

        &:visited {
            color: ${p => p.theme.visitedLinkColor};
        }
    }
`;

const FridaTargetList = styled(InterceptionTargetList)`
    padding: 10px 0;
    margin: 0;
`;

const SelectedHostBlock = styled.div`
    display: flex;
    flex-direction: row;
    align-items: stretch;

    z-index: 1;
    box-shadow: 0 0 5px 2px rgba(0,0,0,${p => p.theme.boxShadowAlpha});
`;

const SelectedHostName = styled.h2`
    height: 34px;
    flex-grow: 1;

    line-height: 32px;
    text-align: center;

    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
`;

const BackButton = styled(IconButton).attrs(() => ({
    icon: ['fas', 'arrow-left'],
    title: 'Jump to this request on the View page'
}))`
    font-size: ${p => p.theme.textSize};
    padding: 0 10px;
`;

// Spacer - used to center align the name despite the back button
const NameSpacer = styled.div`
    flex-basis: 34px;
    flex-shrink: 999;
    min-width: 5px;
`;

const SearchBox = styled(TextInput)`
    border-style: solid;
    border-width: 1px 0 1px 0;
    border-color: ${p => p.theme.inputHoverBackground};
    border-radius: 0;

    padding: 10px 10px 8px;

    :focus {
        outline: none;
        border-color: ${p => p.theme.inputBorder};
    }
`;

// We actively hide specific known non-interceptable apps:
const INCOMPATIBLE_APP_IDS: string[] = [
    "com.apple.mobilesafari"
];

@inject('proxyStore')
@inject('rulesStore')
@inject('eventsStore')
@inject('accountStore')
@observer
class FridaConfig extends React.Component<{
    proxyStore?: ProxyStore,
    rulesStore?: RulesStore,
    eventsStore?: EventsStore,
    accountStore?: AccountStore,

    interceptor: Interceptor,
    activateInterceptor: (options: FridaActivationOptions) => Promise<void>,
    reportStarted: () => void,
    reportSuccess: () => void,
    closeSelf: () => void
}> {

    @computed private get fridaHosts(): Array<FridaHost> {
        return this.props.interceptor.metadata?.hosts || [];
    }

    @observable fridaTargets: Array<FridaTarget> = [];

    updateTargets = flow(function * (this: FridaConfig) {
        if (!this.selectedHost) {
            this.fridaTargets = [];
            return;
        }

        const result: {
            targets: FridaTarget[]
        } | undefined = (
            yield getDetailedInterceptorMetadata(this.props.interceptor.id, this.selectedHost?.id)
        );

        this.fridaTargets = result?.targets?.filter(
            target => !INCOMPATIBLE_APP_IDS.includes(target.id)
        ) ?? [];
    }.bind(this));


    @observable private inProgressHostIds: string[] = [];
    @observable private inProgressTargetIds: string[] = [];

    async componentDidMount() {
        if (this.fridaHosts.length === 1 && this.fridaHosts[0].state === 'available') {
            this.selectHost(this.fridaHosts[0].id);
        }

        disposeOnUnmount(this, autorun(() => {
            if (this.selectedHostId && !this.fridaHosts.some(host => host.id === this.selectedHostId)) {
                this.deselectHost();
            }
        }));

        this.updateTargets();
        const updateInterval = setInterval(this.updateTargets, 2000);
        disposeOnUnmount(this, () => clearInterval(updateInterval));
    }

    @computed
    get deviceClassName() {
        const interceptorId = this.props.interceptor.id;
        if (interceptorId === 'android-frida') {
            return 'Android';
        } else if (interceptorId === 'ios-frida') {
            return 'iOS';
        } else {
            throw new Error(`Unknown Frida interceptor type: ${interceptorId}`);
        }
    }

    @observable selectedHostId: string | undefined;

    @computed
    get selectedHost() {
        if (!this.selectedHostId) return;

        const host = this.getHost(this.selectedHostId);
        if (host?.state === 'unavailable') return;

        return host;
    }

    private getHost(hostId: string) {
        return this.fridaHosts.find(host => host.id === hostId);
    }

    @action.bound
    selectHost(hostId: string) {
        const host = this.getHost(hostId);

        if (host?.state === 'available') {
            this.selectedHostId = hostId;
            this.searchInput = '';
            this.updateTargets();
        } else if (host?.state === 'launch-required') {
            this.inProgressHostIds.push(hostId);
            this.props.activateInterceptor({
                action: 'launch',
                hostId
            }).finally(action(() => {
                _.pull(this.inProgressHostIds, hostId);
            }));
        } else if (host?.state === 'setup-required') {
            this.inProgressHostIds.push(hostId);
            this.props.activateInterceptor({
                action: 'setup',
                hostId
            }).finally(action(() => {
                _.pull(this.inProgressHostIds, hostId);
            }));
        } else {
            return;
        }
    }

    @action.bound
    deselectHost() {
        this.selectedHostId = undefined;
    }

    @action.bound
    interceptTarget(targetId: string) {
        const host = this.selectedHost;

        if (!host) return;

        this.inProgressTargetIds.push(targetId);
        this.props.activateInterceptor({
            action: 'intercept',
            hostId: host.id,
            targetId
        }).then(() => {
            this.props.reportSuccess();
        }).finally(action(() => {
            _.pull(this.inProgressTargetIds, targetId);
        }));
    }

    @observable searchInput: string = '';

    @action.bound
    onSearchChange(event: React.ChangeEvent<HTMLInputElement>) {
        this.searchInput = event.currentTarget.value;
    }

    render() {
        const selectedHost = this.selectedHost;

        if (selectedHost) {
            const lowercaseSearchInput = this.searchInput.toLowerCase();
            const targets = _.sortBy(
                this.fridaTargets
                .filter(({ name }) => name.toLowerCase().includes(lowercaseSearchInput)),
                (target) => target.name.toLowerCase()
            );

            return <ConfigContainer>
                <SelectedHostBlock>
                    <BackButton onClick={this.deselectHost} />
                    <SelectedHostName>{ selectedHost.name }</SelectedHostName>
                    <NameSpacer />
                </SelectedHostBlock>
                <SearchBox
                    value={this.searchInput}
                    onChange={this.onSearchChange}
                    placeholder='Search for a target...'
                    autoFocus={true}
                />
                <FridaTargetList
                    spinnerText='Scanning for apps to intercept...'
                    targets={targets.map(target => {
                            const { id, name } = target;
                            const activating = this.inProgressTargetIds.includes(id);

                            return {
                                id,
                                title: `${this.deviceClassName} app: ${name} (${id})`,
                                status: activating
                                        ? 'activating'
                                        : 'available',
                                content: name
                            };
                        })
                    }
                    interceptTarget={this.interceptTarget}
                    ellipseDirection='right'
                />
            </ConfigContainer>;
        }

        return <ConfigContainer>
            <FridaTargetList
                spinnerText={`Waiting for ${this.deviceClassName} devices to attach to...`}
                targets={this.fridaHosts.map(host => {
                    const { id, name, state } = host;
                    const activating = this.inProgressHostIds.includes(id);

                    return {
                        id,
                        title: `${this.deviceClassName} device ${name} in state ${state}`,
                        status: activating
                                ? 'activating'
                            : state === 'unavailable'
                                ? 'unavailable'
                            // Available here means clickable - interceptable/setupable/launchable
                                : 'available',
                        content: <p>
                            {
                                activating
                                    ? <Icon icon={['fas', 'spinner']} spin />
                                : id.includes("emulator-")
                                    ? <Icon icon={['far', 'window-maximize']} />
                                : id.match(/\d+\.\d+\.\d+\.\d+:\d+/)
                                    ? <Icon icon={['fas', 'network-wired']} />
                                : <Icon icon={['fas', 'mobile-alt']} />
                            } { name }<br />{ state }
                        </p>
                    };
                })}
                interceptTarget={this.selectHost}
                ellipseDirection='right'
            />
        </ConfigContainer>;
    }

}

export const FridaCustomUi = {
    columnWidth: 1,
    rowHeight: 2,
    configComponent: FridaConfig
};