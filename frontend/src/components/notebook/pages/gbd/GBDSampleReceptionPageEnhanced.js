import React, {
  useState,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Grid, Column, Button, Modal, Tile, Tag, Dropdown, TextInput, Loading } from "@carbon/react";
import {
  Archive,
  Upload,
  Edit,
  Checkmark,
  Renew,
  CheckmarkFilled,
  Pending,
} from "@carbon/icons-react";

import { usePermissions } from "../../../../hooks/usePermissions";
import { Permissions } from "../../../../constants/roles";
import PermissionGate from "../../../security/PermissionGate";
import { NotificationContext } from "../../../layout/Layout";
import {
  postToOpenElisServer,
  getFromOpenElisServer,
  postToOpenElisServerJsonResponse,
} from "../../../utils/Utils";
import { NotificationKinds } from "../../../../components/common/CustomNotification";
import GBDManifestImportModal from "../../workflow/GBDManifestImportModal";
import SampleGrid from "../../workflow/SampleGrid";

/**
 * GBDSampleReceptionPage - STAGE 1: Sample Reception & Registration
 *
 * Comprehensive sample creation page following Bioanalytical Lab pattern.
 *
 * STAGE 1 Process:
 * ● Receive samples (DNA, RNA, tissues, isolates)
 * ● Register in LMIS with metadata
 * ● Assign to appropriate workflow (extraction, PCR, library prep, sequencing)
 * ● Track volume/concentration and quality metrics if pre-assessed
 *
 * Features:
 * - Single sample creation via form
 * - Bulk sample creation via CSV manifest import
 * - Progress tracking with counts
 * - Sample grid display with bulk selection
 * - Mark received (transition to workflow)
 * - Edit metadata for received samples
 */
export const GBDSampleReceptionPageEnhanced = ({
                                                 samples = [],
                                                 pageData = {},
                                                 entryId,
                                                 onSampleUpdate,
                                                 onSampleStatusChange,
                                                 isLoading = false,
                                                 notebookId
                                               }) => {

  const intl = useIntl();
  const { setNotificationVisible, addNotification } =
      useContext(NotificationContext);

  const componentMounted = useRef(false);

  const [isManifestModalOpen, setIsManifestModalOpen] = useState(false);
  const [selectedSampleIds, setSelectedSampleIds] = useState([]);
  const [pageSamples, setPageSamples] = useState(samples || []);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [selectedStage, setSelectedStage] = useState(null);
  const [stages, setStages] = useState([]);
  const [transferNotes, setTransferNotes] = useState("");
  const [error, setError] = useState(null);

  /**
   * Load samples for the page
   */
  const loadPageSamples = useCallback(() => {
    if (!pageData?.id || String(pageData.id).startsWith("default-")) {
      return;
    }

    getFromOpenElisServer(
      `/rest/notebook/page/${pageData.id}/samples`,
      (response) => {
        if (componentMounted.current && response && Array.isArray(response)) {
          setPageSamples(response);
        }
      },
    );
  }, [pageData?.id]);


  /**
   * Load workflow stages
   */
    const loadStages = useCallback(() => {
        if (!notebookId || !pageData?.order) return;

        getFromOpenElisServer(`/rest/notebook/view/${notebookId}`, (response) => {
            if (!componentMounted.current) return;

            const pages = response?.pages || [];

            const stageOptions = pages
                .filter((stage) => stage.order === (pageData.order + 2))
                .map((stage) => ({
                    id: String(stage.id),
                    label: stage.title,
                }));

            setStages(stageOptions);
        });
    }, [notebookId, pageData?.order]);

    /**
     * Transfer samples to another stage
     */
    const handleTransferToStage = () => {
        if (!selectedStage) {
            setError("Please select a stage");
            return;
        }

        if (!selectedSampleIds?.length) {
            setError("No samples selected for transfer");
            return;
        }

        setError(null);
        setTransferring(true);

        const requestBody = {
            sampleItemIds: selectedSampleIds,
            fromPageId: pageData.id,
            toPageId: selectedStage.id,
            status: "PENDING",
            notes: transferNotes,
        };

        const completeTransfer = () => {
            postToOpenElisServer(
                `/rest/notebook/bulk/page/${pageData.id}/samples/status`,
                JSON.stringify({
                    sampleIds: selectedSampleIds.map((id) => parseInt(id, 10)),
                    status: "COMPLETED",
                }),
                (status) => {
                    if (status !== 200) {
                        setError("Failed updating sample status");
                        setTransferring(false);
                        return;
                    }

                    // refresh UI
                    setSelectedSampleIds([]);
                    loadPageSamples();

                    if (onSampleStatusChange) {
                        onSampleStatusChange();
                    }

                    setTransferModalOpen(false);
                    setNotificationVisible(true);

                    addNotification({
                        kind: NotificationKinds.success,
                        title: "Samples transferred successfully",
                    });

                    setTransferring(false);
                }
            );
        };

        postToOpenElisServerJsonResponse(
            `/rest/notebook/gbd/workflow/transfer`,
            JSON.stringify(requestBody),
            (response) => {
                console.log("Transfer response:", response);

                if (!response?.success) {
                    setError("Transfer failed");
                    setTransferring(false);
                    return;
                }

                completeTransfer();
            },
            () => {
                setError("Transfer failed");
                setTransferring(false);
            }
        );
    };
  /**
   * Mark samples complete
   */
  const handleMarkComplete = useCallback(() => {
    if (selectedSampleIds.length === 0) {
      setNotificationVisible(true);
      addNotification({
        kind: NotificationKinds.warning,
        title: intl.formatMessage({
          id: "notebook.gbd.noSamplesSelected.title",
          defaultMessage: "No Samples Selected",
        }),
      });
      return;
    }

    postToOpenElisServer(
      `/rest/notebook/bulk/page/${pageData.id}/samples/status`,
      JSON.stringify({
        sampleIds: selectedSampleIds.map((id) => parseInt(id, 10)),
        status: "COMPLETED",
      }),
      (status) => {
        if (status === 200) {
          setSelectedSampleIds([]);
          setNotificationVisible(true);
          addNotification({
            kind: NotificationKinds.success,
            title: intl.formatMessage({
              id: "notebook.gbd.reception.samplesCompleted",
              defaultMessage: "Samples Completed",
            }),
            message: intl.formatMessage(
              {
                id: "notebook.gbd.reception.samplesCompletedMessage",
                defaultMessage:
                  "{count} sample(s) marked as complete and moved to the next workflow step",
              },
              { count: selectedSampleIds.length },
            ),
          });

          setTimeout(() => {
            loadPageSamples();
            if (onSampleStatusChange) {
              onSampleStatusChange();
            }
          }, 500);
        } else {
          setNotificationVisible(true);
          addNotification({
            kind: NotificationKinds.error,
            title: intl.formatMessage({
              id: "notebook.gbd.reception.error",
              defaultMessage: "Error",
            }),
            message: intl.formatMessage({
              id: "notebook.gbd.reception.statusError",
              defaultMessage:
                "Failed to mark samples as complete. Please try again.",
            }),
          });
        }
      },
    );
  }, [
    selectedSampleIds,
    pageData.id,
    intl,
    setNotificationVisible,
    addNotification,
    loadPageSamples,
    onSampleStatusChange,
  ]);

  return (
      <div className="gbd-sample-reception-page">

        <Grid fullWidth>
          <Column lg={16}>
            <Tile>
              Pending Samples: {pendingSamples.length}
            </Tile>
            <Tile>
              Received Samples: {receivedSamples.length}
            </Tile>
          </Column>
        </Grid>

        <div className="page-actions-bar">

          <Button
              kind="secondary"
              renderIcon={Upload}
              onClick={() => setIsManifestModalOpen(true)}
          >
            Import Manifest
          </Button>

          <Button
              kind="secondary"
              renderIcon={Checkmark}
              disabled={selectedSampleIds.length === 0}
              onClick={handleMarkComplete}
          >
            Mark Complete ({selectedSampleIds.length})
          </Button>

          <Button
              kind="primary"
              renderIcon={Archive}
              disabled={selectedSampleIds.length === 0}
              onClick={() => setTransferModalOpen(true)}
          >
            Transfer ({selectedSampleIds.length})
          </Button>

          <Button
              kind="ghost"
              renderIcon={Renew}
              onClick={loadPageSamples}
          >
            Refresh
          </Button>

        </div>

        <SampleGrid
            gridId="gbd-reception"
            samples={pendingSamples}
            selectedIds={selectedSampleIds}
            onSelectionChange={setSelectedSampleIds}
            showSelection={true}
        />

        <GBDManifestImportModal
            open={isManifestModalOpen}
            onClose={() => setIsManifestModalOpen(false)}
            entryId={entryId}
            onImportSuccess={loadPageSamples}
        />

        <Modal
            open={transferModalOpen}
            modalHeading="Transfer Samples"
            primaryButtonText="Transfer"
            secondaryButtonText="Cancel"
            onRequestClose={() => setTransferModalOpen(false)}
            onRequestSubmit={handleTransferToStage}
        >

          {transferring && <Loading withOverlay />}

          <Dropdown
              id="stage-select"
              titleText="Stage"
              items={stages}
              selectedItem={selectedStage}
              itemToString={(item) => item?.label || ""}
              onChange={({ selectedItem }) => setSelectedStage(selectedItem)}
          />

          <TextInput
              id="transfer-notes"
              labelText="Transfer Notes"
              value={transferNotes}
              onChange={(e) => setTransferNotes(e.target.value)}
          />

        </Modal>

      </div>
  );
};