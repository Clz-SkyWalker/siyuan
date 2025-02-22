import {focusBlock, focusByRange} from "./selection";
import {hasClosestBlock, hasClosestByAttribute, hasClosestByClassName} from "./hasClosest";
import {Constants} from "../../constants";
import {paste} from "./paste";
import {cancelSB, genEmptyElement, genSBElement} from "../../block/util";
import {transaction} from "../wysiwyg/transaction";
import {getTopAloneElement} from "../wysiwyg/getBlock";
import {updateListOrder} from "../wysiwyg/list";
import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {onGet} from "./onGet";
/// #if !MOBILE
import {getInstanceById} from "../../layout/util";
import {Tab} from "../../layout/Tab";
import {updatePanelByEditor} from "../../editor/util";
/// #endif
import {Editor} from "../../editor";
import {blockRender} from "../markdown/blockRender";
import {uploadLocalFiles} from "../upload";
import {insertHTML} from "./insertHTML";
import {isBrowser} from "../../util/functions";

const dragSb = (protyle: IProtyle, sourceElements: Element[], targetElement: Element, isBottom: boolean, direct: "col" | "row") => {
    const isSameDoc = protyle.element.contains(sourceElements[0]);

    let newSourceElement: HTMLElement;
    if (sourceElements[0].getAttribute("data-type") === "NodeListItem" && targetElement.getAttribute("data-type") !== "NodeListItem") {
        newSourceElement = document.createElement("div");
        newSourceElement.setAttribute("data-node-id", Lute.NewNodeID());
        newSourceElement.setAttribute("data-type", "NodeList");
        newSourceElement.setAttribute("data-subtype", sourceElements[0].getAttribute("data-subtype"));
        newSourceElement.className = "list";
        newSourceElement.insertAdjacentHTML("beforeend", `<div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div>`);
    }

    const undoOperations: IOperation[] = [{
        action: "move",
        id: targetElement.getAttribute("data-node-id"),
        previousID: targetElement.previousElementSibling?.getAttribute("data-node-id"),
        parentID: targetElement.parentElement?.getAttribute("data-node-id") || protyle.block.parentID || protyle.block.rootID
    }];
    let topSourceElement: Element;
    let oldSourceParentElement = sourceElements[0].parentElement;
    const sbElement = genSBElement(direct);
    targetElement.parentElement.replaceChild(sbElement, targetElement);
    const doOperations: IOperation[] = [{
        action: "insert",
        data: sbElement.outerHTML,
        id: sbElement.getAttribute("data-node-id"),
        nextID: sbElement.nextElementSibling?.getAttribute("data-node-id"),
        previousID: sbElement.previousElementSibling?.getAttribute("data-node-id"),
        parentID: sbElement.parentElement.getAttribute("data-node-id") || protyle.block.parentID || protyle.block.rootID
    }];
    if (newSourceElement) {
        sbElement.insertAdjacentElement("afterbegin", targetElement);
        doOperations.push({
            action: "move",
            id: targetElement.getAttribute("data-node-id"),
            parentID: sbElement.getAttribute("data-node-id")
        });
        if (isBottom) {
            targetElement.insertAdjacentElement("afterend", newSourceElement);
            doOperations.push({
                action: "insert",
                data: newSourceElement.outerHTML,
                id: newSourceElement.getAttribute("data-node-id"),
                previousID: targetElement.getAttribute("data-node-id"),
            });
        } else {
            targetElement.insertAdjacentElement("beforebegin", newSourceElement);
            doOperations.push({
                action: "insert",
                data: newSourceElement.outerHTML,
                id: newSourceElement.getAttribute("data-node-id"),
                nextID: targetElement.getAttribute("data-node-id"),
            });
        }
        sourceElements.reverse().forEach((item, index) => {
            if (index === sourceElements.length - 1) {
                topSourceElement = getTopAloneElement(item);
                if (topSourceElement.isSameNode(item)) {
                    topSourceElement = undefined;
                }
            }
            undoOperations.push({
                action: "move",
                id: item.getAttribute("data-node-id"),
                previousID: item.previousElementSibling?.getAttribute("data-node-id"),
                parentID: item.parentElement.getAttribute("data-node-id") || protyle.block.rootID,
            });
            if (!isSameDoc) {
                // 打开两个相同的文档
                const sameElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${item.getAttribute("data-node-id")}"]`);
                if (sameElement) {
                    sameElement.remove();
                }
            }
            newSourceElement.insertAdjacentElement("afterbegin", item);
            doOperations.push({
                action: "move",
                id: item.getAttribute("data-node-id"),
                parentID: newSourceElement.getAttribute("data-node-id"),
            });
        });
        undoOperations.reverse();
        undoOperations.push({
            action: "delete",
            id: newSourceElement.getAttribute("data-node-id"),
        });
    } else {
        if (!isBottom) {
            sbElement.insertAdjacentElement("afterbegin", targetElement);
            doOperations.push({
                action: "move",
                id: targetElement.getAttribute("data-node-id"),
                parentID: sbElement.getAttribute("data-node-id")
            });
        }
        sourceElements.reverse().forEach((item, index) => {
            if (index === sourceElements.length - 1) {
                topSourceElement = getTopAloneElement(item);
                if (topSourceElement.isSameNode(item)) {
                    topSourceElement = undefined;
                }
            }
            undoOperations.push({
                action: "move",
                id: item.getAttribute("data-node-id"),
                previousID: item.previousElementSibling?.getAttribute("data-node-id"),
                parentID: item.parentElement.getAttribute("data-node-id") || protyle.block.rootID,
            });
            if (!isSameDoc) {
                // 打开两个相同的文档
                const sameElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${item.getAttribute("data-node-id")}"]`);
                if (sameElement) {
                    sameElement.remove();
                }
            }
            sbElement.insertAdjacentElement("afterbegin", item);
            doOperations.push({
                action: "move",
                id: item.getAttribute("data-node-id"),
                parentID: sbElement.getAttribute("data-node-id"),
            });
        });
        undoOperations.reverse();
        if (isBottom) {
            sbElement.insertAdjacentElement("afterbegin", targetElement);
            doOperations.push({
                action: "move",
                id: targetElement.getAttribute("data-node-id"),
                parentID: sbElement.getAttribute("data-node-id")
            });
        }
    }
    undoOperations.push({
        action: "delete",
        id: sbElement.getAttribute("data-node-id"),
    });
    // https://github.com/siyuan-note/insider/issues/536
    if (oldSourceParentElement && oldSourceParentElement.classList.contains("list") &&
        oldSourceParentElement.getAttribute("data-subtype") === "o" &&
        !oldSourceParentElement.isSameNode(sourceElements[0].parentElement) && oldSourceParentElement.childElementCount > 1) {
        Array.from(oldSourceParentElement.children).forEach((item) => {
            if (item.classList.contains("protyle-attr")) {
                return;
            }
            // 撤销更新不能位于最后，否则又更新为最新结果 https://github.com/siyuan-note/siyuan/issues/5725
            undoOperations.splice(0, 0, {
                action: "update",
                id: item.getAttribute("data-node-id"),
                data: item.outerHTML
            });
        });
        updateListOrder(oldSourceParentElement, 1);
        Array.from(oldSourceParentElement.children).forEach((item) => {
            if (item.classList.contains("protyle-attr")) {
                return;
            }
            doOperations.push({
                action: "update",
                id: item.getAttribute("data-node-id"),
                data: item.outerHTML
            });
        });
    }
    // 删除空元素
    if (topSourceElement) {
        doOperations.push({
            action: "delete",
            id: topSourceElement.getAttribute("data-node-id"),
        });
        undoOperations.splice(0, 0, {
            action: "insert",
            data: topSourceElement.outerHTML,
            id: topSourceElement.getAttribute("data-node-id"),
            previousID: topSourceElement.previousElementSibling?.getAttribute("data-node-id"),
            parentID: topSourceElement.parentElement?.getAttribute("data-node-id") || protyle.block.parentID || protyle.block.rootID
        });
        if (!isSameDoc) {
            // 打开两个相同的文档
            const sameElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${topSourceElement.getAttribute("data-node-id")}"]`);
            if (sameElement) {
                sameElement.remove();
            }
        }
        oldSourceParentElement = topSourceElement.parentElement;
        topSourceElement.remove();
    }
    if (oldSourceParentElement && oldSourceParentElement.classList.contains("sb") && oldSourceParentElement.childElementCount === 2) {
        // 拖拽后，sb 只剩下一个元素
        const sbData = cancelSB(protyle, oldSourceParentElement);
        doOperations.push(sbData.doOperations[0], sbData.doOperations[1]);
        undoOperations.splice(0, 0, sbData.undoOperations[0], sbData.undoOperations[1]);
    } else if (oldSourceParentElement && oldSourceParentElement.classList.contains("protyle-wysiwyg") && oldSourceParentElement.innerHTML === "") {
        /// #if !MOBILE
        // 拖拽后，根文档原内容为空，且不为悬浮窗
        const protyleElement = hasClosestByClassName(oldSourceParentElement, "protyle", true);
        if (protyleElement && !protyleElement.classList.contains("block__edit")) {
            const editor = getInstanceById(protyleElement.getAttribute("data-id")) as Tab;
            if (editor && editor.model instanceof Editor && editor.model.editor.protyle.block.id === editor.model.editor.protyle.block.rootID) {
                const newId = Lute.NewNodeID();
                doOperations.splice(0, 0, {
                    action: "insert",
                    id: newId,
                    data: genEmptyElement(false, false, newId).outerHTML,
                    parentID: editor.model.editor.protyle.block.parentID
                });
                undoOperations.splice(0, 0, {
                    action: "delete",
                    id: newId,
                });
            }
        }
        /// #endif
    }
    if (isSameDoc) {
        transaction(protyle, doOperations, undoOperations);
    } else {
        // 跨文档不支持撤销
        transaction(protyle, doOperations);
    }
    focusBlock(sourceElements[0]);
};

const dragSame = (protyle: IProtyle, sourceElements: Element[], targetElement: Element, isBottom: boolean) => {
    const isSameDoc = protyle.element.contains(sourceElements[0]);
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];

    let newSourceElement: HTMLElement;
    if (sourceElements[0].getAttribute("data-type") === "NodeListItem" && targetElement.getAttribute("data-type") !== "NodeListItem") {
        newSourceElement = document.createElement("div");
        newSourceElement.setAttribute("data-node-id", Lute.NewNodeID());
        newSourceElement.setAttribute("data-type", "NodeList");
        newSourceElement.setAttribute("data-subtype", sourceElements[0].getAttribute("data-subtype"));
        newSourceElement.className = "list";
        newSourceElement.insertAdjacentHTML("beforeend", `<div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div>`);
    }
    let topSourceElement: Element;
    let oldSourceParentElement = sourceElements[0].parentElement;
    if (isBottom) {
        if (newSourceElement) {
            targetElement.insertAdjacentElement("afterend", newSourceElement);
            doOperations.push({
                action: "insert",
                data: newSourceElement.outerHTML,
                id: newSourceElement.getAttribute("data-node-id"),
                previousID: targetElement.getAttribute("data-node-id"),
            });
            sourceElements.reverse().forEach((item, index) => {
                if (index === sourceElements.length - 1) {
                    topSourceElement = getTopAloneElement(item);
                    if (topSourceElement.isSameNode(item)) {
                        topSourceElement = undefined;
                    }
                }
                undoOperations.push({
                    action: "move",
                    id: item.getAttribute("data-node-id"),
                    previousID: item.previousElementSibling?.getAttribute("data-node-id"),
                    parentID: item.parentElement.getAttribute("data-node-id") || protyle.block.rootID,
                });
                if (!isSameDoc) {
                    // 打开两个相同的文档
                    const sameElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${item.getAttribute("data-node-id")}"]`);
                    if (sameElement) {
                        sameElement.remove();
                    }
                }
                newSourceElement.insertAdjacentElement("afterbegin", item);
                doOperations.push({
                    action: "move",
                    id: item.getAttribute("data-node-id"),
                    parentID: newSourceElement.getAttribute("data-node-id"),
                });
            });
            undoOperations.reverse();
            if (newSourceElement.getAttribute("data-subtype") === "o") {
                undoOperations.splice(0, 0, {
                    action: "update",
                    id: newSourceElement.getAttribute("data-node-id"),
                    data: newSourceElement.outerHTML
                });
                updateListOrder(newSourceElement, 1);
                doOperations.push({
                    action: "update",
                    id: newSourceElement.getAttribute("data-node-id"),
                    data: newSourceElement.outerHTML
                });
            }
            undoOperations.push({
                action: "delete",
                id: newSourceElement.getAttribute("data-node-id"),
            });
        } else {
            sourceElements.reverse().forEach((item, index) => {
                if (index === sourceElements.length - 1) {
                    topSourceElement = getTopAloneElement(item);
                    if (topSourceElement.isSameNode(item)) {
                        topSourceElement = undefined;
                    } else if (topSourceElement.contains(item) && topSourceElement.contains(targetElement)) {
                        // * * 1 列表项拖拽到父级列表项下 https://ld246.com/article/1665448570858
                        topSourceElement = targetElement;
                    }
                }
                undoOperations.push({
                    action: "move",
                    id: item.getAttribute("data-node-id"),
                    previousID: item.previousElementSibling?.getAttribute("data-node-id"),
                    parentID: item.parentElement.getAttribute("data-node-id") || protyle.block.rootID,
                });
                if (!isSameDoc) {
                    // 打开两个相同的文档
                    const sameElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${item.getAttribute("data-node-id")}"]`);
                    if (sameElement) {
                        sameElement.remove();
                    }
                }
                targetElement.insertAdjacentElement("afterend", item);
                doOperations.push({
                    action: "move",
                    id: item.getAttribute("data-node-id"),
                    previousID: targetElement.getAttribute("data-node-id"),
                });
            });
            undoOperations.reverse();
        }
    } else {
        if (newSourceElement) {
            targetElement.insertAdjacentElement("beforebegin", newSourceElement);
            doOperations.push({
                action: "insert",
                data: newSourceElement.outerHTML,
                id: newSourceElement.getAttribute("data-node-id"),
                nextID: targetElement.getAttribute("data-node-id"),
            });
            sourceElements.reverse().forEach((item, index) => {
                if (index === sourceElements.length - 1) {
                    topSourceElement = getTopAloneElement(item);
                    if (topSourceElement.isSameNode(item)) {
                        topSourceElement = undefined;
                    }
                }
                undoOperations.push({
                    action: "move",
                    id: item.getAttribute("data-node-id"),
                    previousID: item.previousElementSibling?.getAttribute("data-node-id"),
                    parentID: item.parentElement.getAttribute("data-node-id") || protyle.block.rootID,
                });
                if (!isSameDoc) {
                    // 打开两个相同的文档
                    const sameElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${item.getAttribute("data-node-id")}"]`);
                    if (sameElement) {
                        sameElement.remove();
                    }
                }
                newSourceElement.insertAdjacentElement("afterbegin", item);
                doOperations.push({
                    action: "move",
                    id: item.getAttribute("data-node-id"),
                    parentID: newSourceElement.getAttribute("data-node-id"),
                });
            });
            undoOperations.reverse();
            if (newSourceElement.getAttribute("data-subtype") === "o") {
                undoOperations.splice(0, 0, {
                    action: "update",
                    id: newSourceElement.getAttribute("data-node-id"),
                    data: newSourceElement.outerHTML
                });
                updateListOrder(newSourceElement, 1);
                doOperations.push({
                    action: "update",
                    id: newSourceElement.getAttribute("data-node-id"),
                    data: newSourceElement.outerHTML
                });
            }
            undoOperations.push({
                action: "delete",
                id: newSourceElement.getAttribute("data-node-id"),
            });
        } else {
            sourceElements.forEach((item, index) => {
                if (index === sourceElements.length - 1) {
                    topSourceElement = getTopAloneElement(item);
                    if (topSourceElement.isSameNode(item)) {
                        topSourceElement = undefined;
                    } else if (topSourceElement.contains(item) && topSourceElement.contains(targetElement)) {
                        // * * 1 列表项拖拽到父级列表项上 https://ld246.com/article/1665448570858
                        topSourceElement = targetElement;
                    }
                }
                undoOperations.push({
                    action: "move",
                    id: item.getAttribute("data-node-id"),
                    previousID: item.previousElementSibling?.getAttribute("data-node-id"),
                    parentID: item.parentElement.getAttribute("data-node-id") || protyle.block.rootID,
                });
                if (!isSameDoc) {
                    // 打开两个相同的文档
                    const sameElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${item.getAttribute("data-node-id")}"]`);
                    if (sameElement) {
                        sameElement.remove();
                    }
                }
                targetElement.insertAdjacentElement("beforebegin", item);
                doOperations.push({
                    action: "move",
                    id: item.getAttribute("data-node-id"),
                    previousID: item.previousElementSibling?.getAttribute("data-node-id"),
                    parentID: item.parentElement?.getAttribute("data-node-id") || protyle.block.parentID || protyle.block.rootID
                });
            });
            undoOperations.reverse();
        }
    }
    if (targetElement.getAttribute("data-type") === "NodeListItem" && targetElement.getAttribute("data-subtype") === "o") {
        // https://github.com/siyuan-note/insider/issues/536
        Array.from(targetElement.parentElement.children).forEach((item) => {
            if (item.classList.contains("protyle-attr")) {
                return;
            }
            undoOperations.splice(0, 0, {
                action: "update",
                id: item.getAttribute("data-node-id"),
                data: item.outerHTML
            });
        });
        updateListOrder(targetElement.parentElement, 1);
        Array.from(targetElement.parentElement.children).forEach((item) => {
            if (item.classList.contains("protyle-attr")) {
                return;
            }
            doOperations.push({
                action: "update",
                id: item.getAttribute("data-node-id"),
                data: item.outerHTML
            });
        });
    }
    if (oldSourceParentElement && oldSourceParentElement.classList.contains("list") &&
        oldSourceParentElement.getAttribute("data-subtype") === "o" &&
        !oldSourceParentElement.isSameNode(sourceElements[0].parentElement) && oldSourceParentElement.childElementCount > 1) {
        Array.from(oldSourceParentElement.children).forEach((item) => {
            if (item.classList.contains("protyle-attr")) {
                return;
            }
            if (oldSourceParentElement.contains(targetElement)) {
                undoOperations.splice(0, 0, {
                    action: "update",
                    id: item.getAttribute("data-node-id"),
                    data: item.outerHTML
                });
            } else {
                undoOperations.splice(targetElement.parentElement.childElementCount - 1, 0, {
                    action: "update",
                    id: item.getAttribute("data-node-id"),
                    data: item.outerHTML
                });
            }
        });
        updateListOrder(oldSourceParentElement, 1);
        Array.from(oldSourceParentElement.children).forEach((item) => {
            if (item.classList.contains("protyle-attr")) {
                return;
            }
            doOperations.push({
                action: "update",
                id: item.getAttribute("data-node-id"),
                data: item.outerHTML
            });
        });
    }

    // 删除空元素
    if (topSourceElement) {
        doOperations.push({
            action: "delete",
            id: topSourceElement.getAttribute("data-node-id"),
        });
        undoOperations.splice(0, 0, {
            action: "insert",
            data: topSourceElement.outerHTML,
            id: topSourceElement.getAttribute("data-node-id"),
            previousID: topSourceElement.previousElementSibling?.getAttribute("data-node-id"),
            parentID: topSourceElement.parentElement?.getAttribute("data-node-id") || protyle.block.parentID || protyle.block.rootID
        });
        oldSourceParentElement = topSourceElement.parentElement;
        topSourceElement.remove();
        if (!isSameDoc) {
            // 打开两个相同的文档
            const sameElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${topSourceElement.getAttribute("data-node-id")}"]`);
            if (sameElement) {
                sameElement.remove();
            }
        }
    }
    if (oldSourceParentElement && oldSourceParentElement.classList.contains("sb") && oldSourceParentElement.childElementCount === 2) {
        // 拖拽后，sb 只剩下一个元素
        const sbData = cancelSB(protyle, oldSourceParentElement);
        doOperations.push(sbData.doOperations[0], sbData.doOperations[1]);
        undoOperations.splice(0, 0, sbData.undoOperations[0], sbData.undoOperations[1]);
    } else if (oldSourceParentElement && oldSourceParentElement.classList.contains("protyle-wysiwyg") && oldSourceParentElement.childElementCount === 0) {
        /// #if !MOBILE
        // 拖拽后，根文档原内容为空，且不为悬浮窗
        const protyleElement = hasClosestByClassName(oldSourceParentElement, "protyle", true);
        if (protyleElement && !protyleElement.classList.contains("block__edit")) {
            const editor = getInstanceById(protyleElement.getAttribute("data-id")) as Tab;
            if (editor && editor.model instanceof Editor && editor.model.editor.protyle.block.id === editor.model.editor.protyle.block.rootID) {
                const newId = Lute.NewNodeID();
                doOperations.splice(0, 0, {
                    action: "insert",
                    id: newId,
                    data: genEmptyElement(false, false, newId).outerHTML,
                    parentID: editor.model.editor.protyle.block.parentID
                });
                undoOperations.splice(0, 0, {
                    action: "delete",
                    id: newId,
                });
            }
        }
        /// #endif
    }
    if (isSameDoc) {
        transaction(protyle, doOperations, undoOperations);
    } else {
        // 跨文档不支持撤销
        transaction(protyle, doOperations);
    }
    focusBlock(sourceElements[0]);
};

export const dropEvent = (protyle: IProtyle, editorElement: HTMLElement) => {
    editorElement.addEventListener("dragstart", (event) => {
        const target = event.target as HTMLElement;
        if (target.tagName === "IMG") {
            window.siyuan.dragElement = undefined;
            event.preventDefault();
            return;
        }
        if (target.classList && target.classList.contains("protyle-action")) {
            if (hasClosestByClassName(target, "protyle-wysiwyg__embed")) {
                window.siyuan.dragElement = undefined;
                event.preventDefault();
            } else {
                window.siyuan.dragElement = target.parentElement;
            }
            return;
        }
        // 选中编辑器中的文字进行拖拽
        event.dataTransfer.setData(Constants.SIYUAN_DROP_EDITOR, Constants.SIYUAN_DROP_EDITOR);
        protyle.element.style.userSelect = "auto";
        document.onmousemove = null;
        document.onmouseup = null;
    });
    editorElement.addEventListener("drop", async (event: DragEvent & { target: HTMLElement }) => {
        if (protyle.disabled || event.dataTransfer.getData(Constants.SIYUAN_DROP_EDITOR)) {
            // 只读模式/编辑器内选中文字拖拽
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        const targetElement = editorElement.querySelector(".dragover__bottom") || editorElement.querySelector(".dragover__top") || editorElement.querySelector(".dragover__left") || editorElement.querySelector(".dragover__right");
        if (window.siyuan.dragElement && (
            window.siyuan.dragElement.parentElement?.classList.contains("protyle-gutters") ||
            window.siyuan.dragElement.getAttribute("data-type") === "NodeListItem")) {
            // gutter 或反链面板拖拽
            const sourceElements: Element[] = [];
            const selectedIdsData = window.siyuan.dragElement.getAttribute("data-selected-ids");
            const selectedIds = selectedIdsData ? selectedIdsData.split(",") : [window.siyuan.dragElement.getAttribute("data-node-id")];
            selectedIds.forEach(item => {
                window.siyuan.dragElement.parentElement.parentElement.querySelectorAll(`.protyle-wysiwyg [data-node-id="${item}"]`).forEach(elementItem => {
                    if (elementItem.getAttribute("data-type") === "NodeBlockQueryEmbed" ||
                        !hasClosestByAttribute(elementItem, "data-type", "NodeBlockQueryEmbed")) {
                        sourceElements.push(elementItem);
                    }
                });
            });
            sourceElements.forEach(item => {
                item.classList.remove("protyle-wysiwyg--select", "protyle-wysiwyg--hl");
                item.removeAttribute("select-start");
                item.removeAttribute("select-end");
                // 反链提及有高亮，如果拖拽到正文的话，应移除
                item.querySelectorAll('[data-type="search-mark"]').forEach(markItem => {
                    markItem.outerHTML = markItem.innerHTML;
                });
            });
            if (event.altKey) {
                focusByRange(document.caretRangeFromPoint(event.clientX, event.clientY));
                let html = "";
                for (let i = 0; i < selectedIds.length; i++) {
                    const response = await fetchSyncPost("/api/block/getRefText", {id: selectedIds[i]});
                    html += `((${selectedIds[i]} '${response.data}')) `;
                }
                insertHTML(html, protyle);
            } else if (event.shiftKey) {
                focusByRange(document.caretRangeFromPoint(event.clientX, event.clientY));
                let html = "";
                selectedIds.forEach(item => {
                    html += `{{select * from blocks where id='${item}'}}\n`;
                });
                insertHTML(protyle.lute.SpinBlockDOM(html), protyle);
                blockRender(protyle, protyle.wysiwyg.element);
            } else if (targetElement) {
                const targetClass = targetElement.className.split(" ");
                targetElement.classList.remove("dragover__bottom", "dragover__top", "dragover__left", "dragover__right", "protyle-wysiwyg--select");
                if (targetElement.parentElement.getAttribute("data-type") === "NodeSuperBlock" &&
                    targetElement.parentElement.getAttribute("data-sb-layout") === "col") {
                    if (targetClass.includes("dragover__left") || targetClass.includes("dragover__right")) {
                        dragSame(protyle, sourceElements, targetElement, targetClass.includes("dragover__right"));
                    } else {
                        dragSb(protyle, sourceElements, targetElement, targetClass.includes("dragover__bottom"), "row");
                    }
                } else {
                    if (targetClass.includes("dragover__left") || targetClass.includes("dragover__right")) {
                        dragSb(protyle, sourceElements, targetElement, targetClass.includes("dragover__right"), "col");
                    } else {
                        dragSame(protyle, sourceElements, targetElement, targetClass.includes("dragover__bottom"));
                    }
                }
            }
        } else if (event.dataTransfer.getData(Constants.SIYUAN_DROP_FILE)?.split("-").length > 1
            && targetElement && !protyle.options.backlinkData) {
            // 文件树拖拽
            const scrollTop = protyle.contentElement.scrollTop;
            const ids =  event.dataTransfer.getData(Constants.SIYUAN_DROP_FILE).split(",");
            for (let i = 0; i < ids.length; i++) {
                if (ids[i]) {
                    const response = await fetchSyncPost("/api/filetree/doc2Heading", {
                        srcID: ids[i],
                        after: targetElement.classList.contains("dragover__bottom"),
                        targetID: targetElement.getAttribute("data-node-id"),
                    });
                    fetchPost("/api/filetree/removeDoc", {
                        notebook: response.data.srcTreeBox,
                        path: response.data.srcTreePath,
                    });
                }
            }
            fetchPost("/api/filetree/getDoc", {
                id: protyle.block.id,
                size: window.siyuan.config.editor.dynamicLoadBlocks,
            }, getResponse => {
                onGet(getResponse, protyle);
                /// #if !MOBILE
                // 文档标题互转后，需更新大纲
                updatePanelByEditor(protyle, false, false, true);
                /// #endif
                // 文档标题互转后，编辑区会跳转到开头 https://github.com/siyuan-note/siyuan/issues/2939
                setTimeout(() => {
                    protyle.contentElement.scrollTop = scrollTop;
                    protyle.scroll.lastScrollTop = scrollTop - 1;
                }, Constants.TIMEOUT_BLOCKLOAD);
            });
            targetElement.classList.remove("dragover__bottom", "dragover__top");
        } else if (!window.siyuan.dragElement && (event.dataTransfer.types[0] === "Files" || event.dataTransfer.types.includes("text/html"))) {
            // 外部文件拖入编辑器中或者编辑器内选中文字拖拽
            focusByRange(document.caretRangeFromPoint(event.clientX, event.clientY));
            if (event.dataTransfer.types[0] === "Files" && !isBrowser()) {
                const files: string[] = [];
                for (let i = 0; i < event.dataTransfer.files.length; i++) {
                    files.push(event.dataTransfer.files[i].path);
                }
                uploadLocalFiles(files, protyle, !event.altKey);
            } else {
                paste(protyle, event);
            }
        }
        if (window.siyuan.dragElement) {
            window.siyuan.dragElement.style.opacity = "";
            window.siyuan.dragElement = undefined;
        }
    });
    let dragoverElement: Element;
    editorElement.addEventListener("dragover", (event: DragEvent & { target: HTMLElement }) => {
        // 设置了的话 drop 就无法监听 shift/control event.dataTransfer.dropEffect = "move";
        if (event.dataTransfer.types.includes("Files") && event.target.classList.contains("protyle-wysiwyg")) {
            // 文档底部拖拽文件需 preventDefault，否则无法触发 drop 事件 https://github.com/siyuan-note/siyuan/issues/2665
            event.preventDefault();
            return;
        }
        if (!window.siyuan.dragElement) {
            // https://github.com/siyuan-note/siyuan/issues/6436
            event.preventDefault();
            return;
        }
        if (event.shiftKey || event.altKey) {
            const targetElement = hasClosestBlock(event.target);
            if (targetElement) {
                targetElement.classList.remove("dragover__top", "protyle-wysiwyg--select", "dragover__bottom", "dragover__left", "dragover__right");
            }
            event.preventDefault();
            return;
        }
        // 编辑器内文字拖拽或资源文件拖拽或按住 alt/shift 拖拽反链图标进入编辑器时不能运行 event.preventDefault()， 否则无光标; 需放在 !window.siyuan.dragElement 之后
        event.preventDefault();
        const targetElement = hasClosestBlock(event.target) as Element;
        if (!targetElement) {
            return;
        }
        const fileTreeIds = window.siyuan.dragElement.innerText;
        if (targetElement && dragoverElement && targetElement.isSameNode(dragoverElement)) {
            // 性能优化，目标为同一个元素不再进行校验
            const nodeRect = targetElement.getBoundingClientRect();
            targetElement.classList.remove("dragover__top", "dragover__bottom", "dragover__left", "dragover__right");

            if (targetElement.getAttribute("data-type") === "NodeListItem" || fileTreeIds.indexOf("-") > -1) {
                if (event.clientY > nodeRect.top + nodeRect.height / 2) {
                    targetElement.classList.add("dragover__bottom", "protyle-wysiwyg--select");
                } else {
                    targetElement.classList.add("dragover__top", "protyle-wysiwyg--select");
                }
                return;
            }

            if (event.clientX < nodeRect.left + 32 && event.clientX > nodeRect.left) {
                targetElement.classList.add("dragover__left", "protyle-wysiwyg--select");
            } else if (event.clientX > nodeRect.right - 32 && event.clientX < nodeRect.right) {
                targetElement.classList.add("dragover__right", "protyle-wysiwyg--select");
            } else {
                if (event.clientY > nodeRect.top + nodeRect.height / 2) {
                    targetElement.classList.add("dragover__bottom", "protyle-wysiwyg--select");
                } else {
                    targetElement.classList.add("dragover__top", "protyle-wysiwyg--select");
                }
            }
            return;
        }
        if (fileTreeIds.indexOf("-") > -1 && !fileTreeIds.split(",").includes(protyle.block.rootID)) {
            dragoverElement = targetElement;
            return;
        }

        if (window.siyuan.dragElement.parentElement?.classList.contains("protyle-gutters") ||
            // 列表项之前的点
            window.siyuan.dragElement.getAttribute("data-type") === "NodeListItem") {
            // gutter 文档内拖拽限制
            // 排除自己及子孙
            const selectedIdsData = window.siyuan.dragElement.getAttribute("data-selected-ids");
            const selectedIds = selectedIdsData ? selectedIdsData.split(",") : [window.siyuan.dragElement.getAttribute("data-node-id")];
            const isSelf = selectedIds.find((item: string) => {
                if (item && hasClosestByAttribute(targetElement, "data-node-id", item)) {
                    return true;
                }
            });
            if (isSelf) {
                return;
            }
            if (hasClosestByAttribute(targetElement.parentElement, "data-type", "NodeBlockQueryEmbed")) {
                // 不允许托入嵌入块
                return;
            }
            if (window.siyuan.dragElement.getAttribute("data-type") === "NodeListItem" &&
                window.siyuan.dragElement.getAttribute("data-subtype") !== targetElement.getAttribute("data-subtype") &&
                window.siyuan.dragElement.getAttribute("data-type") === targetElement.getAttribute("data-type")) {
                // 排除类型不同的列表项
                return;
            }
            if (window.siyuan.dragElement.getAttribute("data-type") !== "NodeListItem" && targetElement.getAttribute("data-type") === "NodeListItem") {
                // 非列表项不能拖入列表项周围
                return;
            }
            dragoverElement = targetElement;
        }
    });
    editorElement.addEventListener("dragleave", (event: DragEvent & { target: HTMLElement }) => {
        const nodeElement = hasClosestBlock(event.target);
        if (nodeElement) {
            if ((window.siyuan.dragElement?.getAttribute("data-selected-ids") || "").indexOf(nodeElement.getAttribute("data-node-id")) === -1) {
                nodeElement.classList.remove("protyle-wysiwyg--select");
                nodeElement.removeAttribute("select-start");
                nodeElement.removeAttribute("select-end");
            }
            nodeElement.classList.remove("dragover__top", "dragover__bottom", "dragover__left", "dragover__right");
        }
    });
};
